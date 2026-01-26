import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { DialogProps } from '@mui/material';
import {
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Switch,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DialogContent from '@mui/material/DialogContent';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VncScreenHandle } from 'react-vnc';
import { VncScreen } from 'react-vnc';

interface VncObject {
  getVncUrl(): string;
  getName(): string;
  // Power control methods (optional, from VirtualMachine)
  start?: () => Promise<any>;
  stop?: () => Promise<any>;
  pause?: () => Promise<any>;
  unpause?: () => Promise<any>;
  restart?: () => Promise<any>;
}

interface VncConsoleProps extends DialogProps {
  item: VncObject;
  onClose?: () => void;
  open: boolean;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type ScaleMode = 'fit' | 'actual' | 'custom';

// Keyboard layouts with their keysym mappings for special characters
interface KeyboardLayout {
  name: string;
  code: string;
  // Map of character to keysym (for characters that differ from US layout)
  charMap?: Record<string, number>;
}

const KEYBOARD_LAYOUTS: KeyboardLayout[] = [
  { name: 'US English', code: 'en-US' },
  { name: 'UK English', code: 'en-GB', charMap: { '#': 0x00a3, '£': 0x0023 } },
  { name: 'German', code: 'de-DE', charMap: { 'z': 0x0079, 'y': 0x007a, 'Z': 0x0059, 'Y': 0x005a, 'ö': 0x00f6, 'ä': 0x00e4, 'ü': 0x00fc, 'ß': 0x00df } },
  { name: 'French', code: 'fr-FR', charMap: { 'a': 0x0071, 'q': 0x0061, 'z': 0x0077, 'w': 0x007a, 'A': 0x0051, 'Q': 0x0041, 'Z': 0x0057, 'W': 0x005a, 'é': 0x00e9, 'è': 0x00e8, 'ç': 0x00e7 } },
  { name: 'Spanish', code: 'es-ES', charMap: { 'ñ': 0x00f1, 'Ñ': 0x00d1, '¿': 0x00bf, '¡': 0x00a1 } },
  { name: 'Italian', code: 'it-IT', charMap: { 'à': 0x00e0, 'è': 0x00e8, 'ì': 0x00ec, 'ò': 0x00f2, 'ù': 0x00f9 } },
  { name: 'Portuguese', code: 'pt-PT', charMap: { 'ç': 0x00e7, 'ã': 0x00e3, 'õ': 0x00f5 } },
  { name: 'Russian', code: 'ru-RU' },
  { name: 'Japanese', code: 'ja-JP' },
];

// Key codes for special keys (X11 keysyms)
const KeyCodes = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
  MetaLeft: 0xffe7,
  MetaRight: 0xffe8,
  Super: 0xffeb,
  Print: 0xff61,
  ScrollLock: 0xff14,
  Pause: 0xff13,
  CapsLock: 0xffe5,
  NumLock: 0xff7f,
};

// Touch keyboard layout for mobile
const TOUCH_KEYBOARD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

export default function VncConsole(props: VncConsoleProps) {
  const { item, onClose, open, ...other } = props;
  const { t } = useTranslation(['translation', 'glossary']);

  // Connection state
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  // UI state
  const [clipboardText, setClipboardText] = useState('');
  const [sendKeysAnchor, setSendKeysAnchor] = useState<null | HTMLElement>(null);
  const [powerAnchor, setPowerAnchor] = useState<null | HTMLElement>(null);
  const [powerLoading, setPowerLoading] = useState<string | null>(null);
  const [keyboardAnchor, setKeyboardAnchor] = useState<null | HTMLElement>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [displayAnchor, setDisplayAnchor] = useState<null | HTMLElement>(null);
  const [audioAnchor, setAudioAnchor] = useState<null | HTMLElement>(null);
  const [layoutAnchor, setLayoutAnchor] = useState<null | HTMLElement>(null);

  // Display settings
  const [viewOnly, setViewOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [qualityLevel, setQualityLevel] = useState(6);

  // Multi-monitor support
  const [availableDisplays, setAvailableDisplays] = useState<number[]>([0]);
  const [currentDisplay, setCurrentDisplay] = useState(0);

  // Audio support
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(80);
  const [audioSupported, setAudioSupported] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Keyboard layout
  const [keyboardLayout, setKeyboardLayout] = useState<string>('en-US');
  const [detectedLayout, setDetectedLayout] = useState<string | null>(null);

  // Touch support
  const [touchEnabled, setTouchEnabled] = useState(false);
  const [showTouchKeyboard, setShowTouchKeyboard] = useState(false);
  const [touchShiftActive, setTouchShiftActive] = useState(false);
  const [pinchStartDistance, setPinchStartDistance] = useState<number | null>(null);
  const [pinchStartZoom, setPinchStartZoom] = useState(100);

  // Refs
  const vncRef = useRef<VncScreenHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Detect keyboard layout on mount
  useEffect(() => {
    const detectKeyboardLayout = () => {
      // Try to detect from navigator
      const navLang = navigator.language || (navigator as any).userLanguage;
      if (navLang) {
        const matchedLayout = KEYBOARD_LAYOUTS.find(l =>
          l.code.toLowerCase() === navLang.toLowerCase() ||
          l.code.split('-')[0] === navLang.split('-')[0]
        );
        if (matchedLayout) {
          setDetectedLayout(matchedLayout.code);
          setKeyboardLayout(matchedLayout.code);
        }
      }
    };
    detectKeyboardLayout();
  }, []);

  // Detect touch device
  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setTouchEnabled(isTouchDevice);
  }, []);

  // Reset status when dialog opens
  useEffect(() => {
    if (open) {
      setStatus('connecting');
      setErrorMessage(null);
    }
  }, [open]);

  const vncUrl = open ? item.getVncUrl() : '';

  const handleConnect = useCallback(() => {
    console.log('VNC connected');
    setStatus('connected');
    setErrorMessage(null);

    // Check for multi-monitor support after connection
    setTimeout(() => {
      const rfb = vncRef.current?.rfb;
      if (rfb) {
        // Try to detect available displays (this depends on QEMU/libvirt configuration)
        // Most VMs have at least 1 display, some may have multiple
        // Note: noVNC doesn't directly expose multi-monitor info, this is a best-effort detection
        try {
          const canvas = (rfb as any)._canvas as HTMLCanvasElement;
          if (canvas) {
            // Check if there might be multiple displays based on resolution
            // This is heuristic - actual multi-monitor would need QEMU agent support
            const width = canvas.width;
            const height = canvas.height;

            // If width is much larger than typical 16:9/16:10, might be multiple displays
            const aspectRatio = width / height;
            if (aspectRatio > 2.5) {
              // Likely 2 or more displays side by side
              const estimatedDisplays = Math.round(aspectRatio / 1.7); // ~1.7 is typical single display ratio
              setAvailableDisplays(Array.from({ length: estimatedDisplays }, (_, i) => i));
            } else {
              setAvailableDisplays([0]);
            }
          }
        } catch (e) {
          console.log('Could not detect displays:', e);
        }

        // Check for audio support
        // QEMU audio over WebSocket requires specific backend configuration
        // This checks if the capability might be available
        setAudioSupported(true); // Enable UI, actual audio depends on backend
      }
    }, 1000);
  }, []);

  // Set up clipboard sync from VM to local after connection
  useEffect(() => {
    if (status !== 'connected') return;

    const timeoutId = setTimeout(() => {
      const rfb = vncRef.current?.rfb;
      if (rfb) {
        console.log('Setting up clipboard listener');
        const clipboardHandler = (e: CustomEvent<{ text: string }>) => {
          const text = e.detail.text;
          console.log('Clipboard event received:', text?.substring(0, 50));
          if (text) {
            navigator.clipboard.writeText(text).then(() => {
              console.log('Copied from VM to clipboard successfully');
            }).catch(err => {
              console.error('Failed to copy to clipboard:', err);
            });
          }
        };
        rfb.addEventListener('clipboard', clipboardHandler as EventListener);

        return () => {
          rfb.removeEventListener('clipboard', clipboardHandler as EventListener);
        };
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [status]);

  const handleDisconnect = useCallback(() => {
    console.log('VNC disconnected');
    setStatus('disconnected');
  }, []);

  const handleError = useCallback(
    (e?: { detail: { status: number; reason: string } }) => {
      console.log('VNC error', e);
      setStatus('error');
      setErrorMessage(e?.detail?.reason || t('VNC connection failed'));
    },
    [t]
  );

  const handleCredentialsRequired = useCallback(() => {
    console.log('VNC credentials required');
    setErrorMessage(t('VNC credentials required but not supported'));
  }, [t]);

  // Get keysym for character based on keyboard layout
  const getKeysymForChar = useCallback((char: string): number => {
    const layout = KEYBOARD_LAYOUTS.find(l => l.code === keyboardLayout);
    if (layout?.charMap && layout.charMap[char] !== undefined) {
      return layout.charMap[char];
    }
    return char.charCodeAt(0);
  }, [keyboardLayout]);

  // Send a key combination
  const sendKeys = useCallback((keys: number[]) => {
    const rfb = vncRef.current?.rfb;
    if (!rfb || viewOnly) return;

    keys.forEach(key => rfb.sendKey(key, null, true));
    [...keys].reverse().forEach(key => rfb.sendKey(key, null, false));
  }, [viewOnly]);

  // Send Ctrl+Alt+Delete
  const sendCtrlAltDel = useCallback(() => {
    sendKeys([KeyCodes.ControlLeft, KeyCodes.AltLeft, KeyCodes.Delete]);
    setSendKeysAnchor(null);
  }, [sendKeys]);

  // Send Ctrl+Alt+Backspace
  const sendCtrlAltBackspace = useCallback(() => {
    sendKeys([KeyCodes.ControlLeft, KeyCodes.AltLeft, KeyCodes.Backspace]);
    setSendKeysAnchor(null);
  }, [sendKeys]);

  // Send Ctrl+Alt+F1-F12
  const sendCtrlAltFn = useCallback(
    (n: number) => {
      const fnKey = KeyCodes.F1 + n - 1;
      sendKeys([KeyCodes.ControlLeft, KeyCodes.AltLeft, fnKey]);
      setSendKeysAnchor(null);
    },
    [sendKeys]
  );

  // Type text character by character with keyboard layout support
  const typeText = useCallback((text: string) => {
    const rfb = vncRef.current?.rfb;
    if (!rfb || !text || viewOnly) return;

    for (const char of text) {
      const code = getKeysymForChar(char);
      rfb.sendKey(code, null, true);
      rfb.sendKey(code, null, false);
    }
  }, [viewOnly, getKeysymForChar]);

  // Send the clipboard text as keystrokes
  const sendClipboardText = useCallback(() => {
    if (!clipboardText) return;
    typeText(clipboardText);
    setClipboardText('');
  }, [clipboardText, typeText]);

  // Read from system clipboard and type it
  const pasteFromSystemClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        typeText(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  }, [typeText]);

  // Power control handlers
  const handlePowerAction = useCallback(async (action: string, fn?: () => Promise<any>) => {
    if (!fn) return;
    setPowerLoading(action);
    setPowerAnchor(null);
    try {
      await fn();
      console.log(`Power action ${action} successful`);
    } catch (err) {
      console.error(`Power action ${action} failed:`, err);
    } finally {
      setPowerLoading(null);
    }
  }, []);

  const handleShutdown = useCallback(() => {
    handlePowerAction('shutdown', item.stop);
  }, [handlePowerAction, item.stop]);

  const handleRestart = useCallback(async () => {
    if (!item.stop || !item.start) return;
    setPowerLoading('restart');
    setPowerAnchor(null);
    try {
      await item.stop();
      setTimeout(async () => {
        try {
          await item.start?.();
          console.log('Restart successful');
        } catch (err) {
          console.error('Start after restart failed:', err);
        } finally {
          setPowerLoading(null);
        }
      }, 2000);
    } catch (err) {
      console.error('Stop for restart failed:', err);
      setPowerLoading(null);
    }
  }, [item.stop, item.start]);

  const handlePause = useCallback(() => {
    handlePowerAction('pause', item.pause);
  }, [handlePowerAction, item.pause]);

  const handleUnpause = useCallback(() => {
    handlePowerAction('unpause', item.unpause);
  }, [handlePowerAction, item.unpause]);

  const handleForceStop = useCallback(async () => {
    handlePowerAction('force-stop', item.stop);
  }, [handlePowerAction, item.stop]);

  // Reconnect
  const handleReconnect = useCallback(() => {
    setStatus('connecting');
    setErrorMessage(null);
    setReconnectKey(prev => prev + 1);
  }, []);

  // Disconnect
  const handleManualDisconnect = useCallback(() => {
    const rfb = vncRef.current?.rfb;
    if (rfb) {
      rfb.disconnect();
    }
    setStatus('disconnected');
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!dialogRef.current) return;

    if (!document.fullscreenElement) {
      dialogRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error('Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Take screenshot
  const takeScreenshot = useCallback(() => {
    const rfb = vncRef.current?.rfb;
    if (!rfb) return;

    const canvas = (rfb as any)._canvas as HTMLCanvasElement;
    if (!canvas) return;

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vnc-screenshot-${item.getName()}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [item]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev + 25, 200));
    setScaleMode('custom');
  }, []);

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev - 25, 25));
    setScaleMode('custom');
  }, []);

  const resetZoom = useCallback(() => {
    setZoomLevel(100);
    setScaleMode('fit');
  }, []);

  // Switch display (multi-monitor)
  const switchDisplay = useCallback((displayIndex: number) => {
    setCurrentDisplay(displayIndex);
    setDisplayAnchor(null);

    // In a real multi-monitor setup, this would send a command to switch displays
    // For now, we scroll to the appropriate portion of a wide display
    const rfb = vncRef.current?.rfb;
    if (rfb && containerRef.current) {
      const canvas = (rfb as any)._canvas as HTMLCanvasElement;
      if (canvas && availableDisplays.length > 1) {
        const displayWidth = canvas.width / availableDisplays.length;
        containerRef.current.scrollLeft = displayIndex * displayWidth;
      }
    }
  }, [availableDisplays.length]);

  // Audio controls
  const toggleAudio = useCallback(() => {
    if (!audioEnabled) {
      // Initialize audio context with error handling
      try {
        if (!audioContextRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            audioContextRef.current = new AudioContextClass();
          } else {
            console.warn('AudioContext not supported');
            return;
          }
        }
        setAudioEnabled(true);
        console.log('Audio enabled (requires backend support)');
      } catch (err) {
        console.error('Failed to create AudioContext:', err);
      }
    } else {
      setAudioEnabled(false);
      try {
        if (audioContextRef.current) {
          audioContextRef.current.suspend();
        }
      } catch (err) {
        console.error('Failed to suspend AudioContext:', err);
      }
    }
  }, [audioEnabled]);

  const toggleMute = useCallback(() => {
    setAudioMuted(prev => !prev);
  }, []);

  // Apply view only mode
  useEffect(() => {
    const rfb = vncRef.current?.rfb;
    if (rfb) {
      rfb.viewOnly = viewOnly;
    }
  }, [viewOnly, status]);

  // Apply quality level
  useEffect(() => {
    const rfb = vncRef.current?.rfb;
    if (rfb) {
      rfb.qualityLevel = qualityLevel;
    }
  }, [qualityLevel, status]);

  // Virtual keyboard - send single key
  const sendSingleKey = useCallback((keyCode: number) => {
    const rfb = vncRef.current?.rfb;
    if (!rfb || viewOnly) return;
    rfb.sendKey(keyCode, null, true);
    rfb.sendKey(keyCode, null, false);
    setKeyboardAnchor(null);
  }, [viewOnly]);

  // Touch keyboard - send character
  const sendTouchChar = useCallback((char: string) => {
    const rfb = vncRef.current?.rfb;
    if (!rfb || viewOnly) return;

    let actualChar = char;
    if (touchShiftActive) {
      actualChar = char.toUpperCase();
      setTouchShiftActive(false);
    }

    const code = getKeysymForChar(actualChar);
    rfb.sendKey(code, null, true);
    rfb.sendKey(code, null, false);
  }, [viewOnly, touchShiftActive, getKeysymForChar]);

  // Touch gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Start pinch gesture
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      setPinchStartDistance(distance);
      setPinchStartZoom(zoomLevel);
    }
  }, [zoomLevel]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistance !== null) {
      // Handle pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const scale = distance / pinchStartDistance;
      const newZoom = Math.min(200, Math.max(25, pinchStartZoom * scale));
      setZoomLevel(Math.round(newZoom));
      setScaleMode('custom');
    }
  }, [pinchStartDistance, pinchStartZoom]);

  const handleTouchEnd = useCallback(() => {
    setPinchStartDistance(null);
  }, []);

  // Get scale style based on mode
  const getScaleStyle = () => {
    if (scaleMode === 'fit') {
      return {
        width: '100%',
        height: '100%',
        '& canvas': {
          width: '100% !important',
          height: '100% !important',
          objectFit: 'contain' as const,
        },
      };
    } else if (scaleMode === 'actual') {
      return {
        width: 'auto',
        height: 'auto',
        overflow: 'auto',
        '& canvas': {
          width: 'auto !important',
          height: 'auto !important',
        },
      };
    } else {
      return {
        width: '100%',
        height: '100%',
        overflow: 'auto',
        '& > div': {
          transform: `scale(${zoomLevel / 100})`,
          transformOrigin: 'top left',
        },
        '& canvas': {
          width: 'auto !important',
          height: 'auto !important',
        },
      };
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      withFullScreen
      title={`VNC Console: ${item.getName()}`}
      {...other}
    >
      <DialogContent
        ref={dialogRef}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Main Toolbar */}
        {status === 'connected' && (
          <Toolbar
            variant="dense"
            sx={{
              minHeight: 48,
              backgroundColor: 'background.paper',
              borderBottom: 1,
              borderColor: 'divider',
              gap: 1,
              flexWrap: 'wrap',
              py: 1,
            }}
          >
            {/* Send Keys Group */}
            <Tooltip title="Ctrl+Alt+Delete">
              <IconButton size="medium" onClick={sendCtrlAltDel} disabled={viewOnly}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.85rem' }}>
                  C-A-D
                </Typography>
              </IconButton>
            </Tooltip>

            <Tooltip title="Send Keys">
              <IconButton size="medium" onClick={e => setSendKeysAnchor(e.currentTarget)} disabled={viewOnly}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.85rem' }}>
                  Keys▾
                </Typography>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={sendKeysAnchor}
              open={Boolean(sendKeysAnchor)}
              onClose={() => setSendKeysAnchor(null)}
            >
              <MenuItem onClick={sendCtrlAltDel}>Ctrl+Alt+Delete</MenuItem>
              <MenuItem onClick={sendCtrlAltBackspace}>Ctrl+Alt+Backspace</MenuItem>
              <Divider />
              <MenuItem onClick={() => sendCtrlAltFn(1)}>Ctrl+Alt+F1</MenuItem>
              <MenuItem onClick={() => sendCtrlAltFn(2)}>Ctrl+Alt+F2</MenuItem>
              <MenuItem onClick={() => sendCtrlAltFn(3)}>Ctrl+Alt+F3</MenuItem>
              <MenuItem onClick={() => sendCtrlAltFn(7)}>Ctrl+Alt+F7</MenuItem>
              <Divider />
              <MenuItem onClick={() => sendKeys([KeyCodes.Super])}>Super/Win Key</MenuItem>
              <MenuItem onClick={() => sendKeys([KeyCodes.Print])}>Print Screen</MenuItem>
              <MenuItem onClick={() => sendKeys([KeyCodes.Pause])}>Pause/Break</MenuItem>
            </Menu>

            <Divider orientation="vertical" flexItem />

            {/* Virtual Keyboard */}
            <Tooltip title="Virtual Keyboard">
              <IconButton size="medium" onClick={e => setKeyboardAnchor(e.currentTarget)} disabled={viewOnly}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.5rem', lineHeight: 1 }}>
                  ⌨️
                </Typography>
              </IconButton>
            </Tooltip>

            <Popover
              anchorEl={keyboardAnchor}
              open={Boolean(keyboardAnchor)}
              onClose={() => setKeyboardAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
              <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold', mb: 1 }}>Function Keys</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxWidth: 300 }}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                    <Button key={n} size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.F1 + n - 1)} sx={{ minWidth: 40 }}>
                      F{n}
                    </Button>
                  ))}
                </Box>
                <Typography variant="caption" sx={{ fontWeight: 'bold', mt: 1 }}>Navigation</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.Escape)}>Esc</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.Tab)}>Tab</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.Insert)}>Ins</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.Delete)}>Del</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.Home)}>Home</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.End)}>End</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.PageUp)}>PgUp</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.PageDown)}>PgDn</Button>
                </Box>
                <Typography variant="caption" sx={{ fontWeight: 'bold', mt: 1 }}>Modifiers</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.CapsLock)}>Caps</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.NumLock)}>Num</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.ScrollLock)}>Scroll</Button>
                  <Button size="small" variant="outlined" onClick={() => sendSingleKey(KeyCodes.Super)}>Super</Button>
                </Box>
              </Box>
            </Popover>

            {/* Keyboard Layout Selector */}
            <Tooltip title="Keyboard Layout">
              <IconButton size="medium" onClick={e => setLayoutAnchor(e.currentTarget)}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>
                  {keyboardLayout.split('-')[0].toUpperCase()}
                </Typography>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={layoutAnchor}
              open={Boolean(layoutAnchor)}
              onClose={() => setLayoutAnchor(null)}
            >
              {detectedLayout && (
                <MenuItem disabled>
                  <Typography variant="caption" color="text.secondary">
                    Detected: {KEYBOARD_LAYOUTS.find(l => l.code === detectedLayout)?.name || detectedLayout}
                  </Typography>
                </MenuItem>
              )}
              {detectedLayout && <Divider />}
              {KEYBOARD_LAYOUTS.map(layout => (
                <MenuItem
                  key={layout.code}
                  onClick={() => {
                    setKeyboardLayout(layout.code);
                    setLayoutAnchor(null);
                  }}
                  selected={keyboardLayout === layout.code}
                >
                  {layout.name}
                </MenuItem>
              ))}
            </Menu>

            <Divider orientation="vertical" flexItem />

            {/* Multi-Monitor Controls */}
            {availableDisplays.length > 1 && (
              <>
                <Tooltip title="Switch Display">
                  <IconButton size="medium" onClick={e => setDisplayAnchor(e.currentTarget)}>
                    <Badge badgeContent={currentDisplay + 1} color="primary">
                      <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                        🖥️
                      </Typography>
                    </Badge>
                  </IconButton>
                </Tooltip>

                <Menu
                  anchorEl={displayAnchor}
                  open={Boolean(displayAnchor)}
                  onClose={() => setDisplayAnchor(null)}
                >
                  <MenuItem disabled>
                    <Typography variant="caption" color="text.secondary">
                      {availableDisplays.length} displays detected
                    </Typography>
                  </MenuItem>
                  <Divider />
                  {availableDisplays.map(idx => (
                    <MenuItem
                      key={idx}
                      onClick={() => switchDisplay(idx)}
                      selected={currentDisplay === idx}
                    >
                      Display {idx + 1}
                    </MenuItem>
                  ))}
                </Menu>

                <Divider orientation="vertical" flexItem />
              </>
            )}

            {/* Audio Controls */}
            {audioSupported && (
              <>
                <Tooltip title={audioEnabled ? (audioMuted ? 'Unmute' : 'Mute') : 'Enable Audio'}>
                  <IconButton size="medium" onClick={e => setAudioAnchor(e.currentTarget)}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                      {!audioEnabled ? '🔇' : audioMuted ? '🔇' : '🔊'}
                    </Typography>
                  </IconButton>
                </Tooltip>

                <Menu
                  anchorEl={audioAnchor}
                  open={Boolean(audioAnchor)}
                  onClose={() => setAudioAnchor(null)}
                >
                  <Box sx={{ px: 2, py: 1 }}>
                    <Typography variant="subtitle2">Audio Settings</Typography>
                  </Box>
                  <MenuItem onClick={toggleAudio}>
                    <FormControlLabel
                      control={<Switch checked={audioEnabled} size="small" />}
                      label="Enable Audio"
                      onClick={e => e.stopPropagation()}
                      onChange={toggleAudio}
                    />
                  </MenuItem>
                  {audioEnabled && (
                    <>
                      <MenuItem onClick={toggleMute}>
                        <FormControlLabel
                          control={<Switch checked={audioMuted} size="small" />}
                          label="Mute"
                          onClick={e => e.stopPropagation()}
                          onChange={toggleMute}
                        />
                      </MenuItem>
                      <Divider />
                      <Box sx={{ px: 2, py: 1 }}>
                        <Typography variant="caption" color="text.secondary">Volume</Typography>
                      </Box>
                      {[25, 50, 75, 100].map(vol => (
                        <MenuItem
                          key={vol}
                          onClick={() => setAudioVolume(vol)}
                          selected={audioVolume === vol}
                          disabled={audioMuted}
                        >
                          {vol}%
                        </MenuItem>
                      ))}
                    </>
                  )}
                  <Divider />
                  <Box sx={{ px: 2, py: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Audio requires QEMU backend support with audio device configured.
                    </Typography>
                  </Box>
                </Menu>

                <Divider orientation="vertical" flexItem />
              </>
            )}

            {/* Clipboard Group */}
            <Tooltip title="Paste from clipboard">
              <IconButton size="medium" onClick={pasteFromSystemClipboard} disabled={viewOnly}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  📋
                </Typography>
              </IconButton>
            </Tooltip>

            <TextField
              size="small"
              placeholder="Text to send..."
              value={clipboardText}
              onChange={e => setClipboardText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendClipboardText(); }}
              disabled={viewOnly}
              sx={{ width: 160 }}
              InputProps={{
                sx: { height: 32, fontSize: '0.875rem' },
              }}
            />

            <Tooltip title="Send text">
              <IconButton size="medium" onClick={sendClipboardText} disabled={!clipboardText || viewOnly}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  ➤
                </Typography>
              </IconButton>
            </Tooltip>

            <Divider orientation="vertical" flexItem />

            {/* View Controls */}
            <Tooltip title="Zoom Out">
              <IconButton size="medium" onClick={zoomOut}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  −
                </Typography>
              </IconButton>
            </Tooltip>

            <Tooltip title="Reset Zoom">
              <IconButton size="medium" onClick={resetZoom}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>
                  {zoomLevel}%
                </Typography>
              </IconButton>
            </Tooltip>

            <Tooltip title="Zoom In">
              <IconButton size="medium" onClick={zoomIn}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  +
                </Typography>
              </IconButton>
            </Tooltip>

            <Tooltip title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
              <IconButton size="medium" onClick={toggleFullscreen}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  {isFullscreen ? '⊡' : '⛶'}
                </Typography>
              </IconButton>
            </Tooltip>

            <Tooltip title="Screenshot">
              <IconButton size="medium" onClick={takeScreenshot}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  📷
                </Typography>
              </IconButton>
            </Tooltip>

            <Divider orientation="vertical" flexItem />

            {/* Settings */}
            <Tooltip title="Settings">
              <IconButton size="medium" onClick={e => setSettingsAnchor(e.currentTarget)}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  ⚙
                </Typography>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={settingsAnchor}
              open={Boolean(settingsAnchor)}
              onClose={() => setSettingsAnchor(null)}
            >
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2">Display Settings</Typography>
              </Box>
              <MenuItem onClick={() => setViewOnly(!viewOnly)}>
                <FormControlLabel
                  control={<Switch checked={viewOnly} size="small" />}
                  label="View Only Mode"
                  onClick={e => e.stopPropagation()}
                  onChange={() => setViewOnly(!viewOnly)}
                />
              </MenuItem>
              <Divider />
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="caption" color="text.secondary">Scale Mode</Typography>
              </Box>
              <MenuItem
                onClick={() => setScaleMode('fit')}
                selected={scaleMode === 'fit'}
              >
                Fit to Window
              </MenuItem>
              <MenuItem
                onClick={() => setScaleMode('actual')}
                selected={scaleMode === 'actual'}
              >
                Actual Size
              </MenuItem>
              <Divider />
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="caption" color="text.secondary">Quality Level</Typography>
              </Box>
              {[0, 3, 6, 9].map(q => (
                <MenuItem
                  key={q}
                  onClick={() => setQualityLevel(q)}
                  selected={qualityLevel === q}
                >
                  {q === 0 ? 'Low (Fastest)' : q === 3 ? 'Medium-Low' : q === 6 ? 'Medium-High' : 'High (Best)'}
                </MenuItem>
              ))}
              {touchEnabled && (
                <>
                  <Divider />
                  <Box sx={{ px: 2, py: 1 }}>
                    <Typography variant="subtitle2">Touch Settings</Typography>
                  </Box>
                  <MenuItem onClick={() => setShowTouchKeyboard(!showTouchKeyboard)}>
                    <FormControlLabel
                      control={<Switch checked={showTouchKeyboard} size="small" />}
                      label="Show Touch Keyboard"
                      onClick={e => e.stopPropagation()}
                      onChange={() => setShowTouchKeyboard(!showTouchKeyboard)}
                    />
                  </MenuItem>
                </>
              )}
            </Menu>

            <Divider orientation="vertical" flexItem />

            {/* Power Controls */}
            <Tooltip title="Power Controls">
              <IconButton
                size="medium"
                onClick={e => setPowerAnchor(e.currentTarget)}
                disabled={!!powerLoading}
              >
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  {powerLoading ? '⏳' : '⚡'}
                </Typography>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={powerAnchor}
              open={Boolean(powerAnchor)}
              onClose={() => setPowerAnchor(null)}
            >
              {item.stop && (
                <MenuItem onClick={handleShutdown} disabled={!!powerLoading}>
                  <Typography sx={{ mr: 1 }}>🔴</Typography>
                  Shutdown (Graceful)
                </MenuItem>
              )}
              {item.stop && item.start && (
                <MenuItem onClick={handleRestart} disabled={!!powerLoading}>
                  <Typography sx={{ mr: 1 }}>🔄</Typography>
                  Restart
                </MenuItem>
              )}
              {item.pause && (
                <MenuItem onClick={handlePause} disabled={!!powerLoading}>
                  <Typography sx={{ mr: 1 }}>⏸</Typography>
                  Pause VM
                </MenuItem>
              )}
              {item.unpause && (
                <MenuItem onClick={handleUnpause} disabled={!!powerLoading}>
                  <Typography sx={{ mr: 1 }}>▶</Typography>
                  Unpause VM
                </MenuItem>
              )}
              <Divider />
              {item.stop && (
                <MenuItem onClick={handleForceStop} disabled={!!powerLoading} sx={{ color: 'error.main' }}>
                  <Typography sx={{ mr: 1 }}>⚠️</Typography>
                  Force Stop
                </MenuItem>
              )}
              <Divider />
              <MenuItem onClick={() => { sendCtrlAltDel(); setPowerAnchor(null); }} disabled={viewOnly}>
                <Typography sx={{ mr: 1 }}>⌨️</Typography>
                Send Ctrl+Alt+Delete
              </MenuItem>
            </Menu>

            <Divider orientation="vertical" flexItem />

            {/* Touch Keyboard Toggle (mobile only) */}
            {touchEnabled && (
              <>
                <Tooltip title="Toggle Touch Keyboard">
                  <IconButton
                    size="medium"
                    onClick={() => setShowTouchKeyboard(!showTouchKeyboard)}
                    color={showTouchKeyboard ? 'primary' : 'default'}
                    disabled={viewOnly}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                      📱
                    </Typography>
                  </IconButton>
                </Tooltip>

                <Divider orientation="vertical" flexItem />
              </>
            )}

            {/* Connection Controls */}
            <Tooltip title="Reconnect">
              <IconButton size="medium" onClick={handleReconnect}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  🔄
                </Typography>
              </IconButton>
            </Tooltip>

            <Tooltip title="Disconnect">
              <IconButton size="medium" onClick={handleManualDisconnect}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '1.2rem' }}>
                  ⏏
                </Typography>
              </IconButton>
            </Tooltip>

            <Box sx={{ flex: 1 }} />

            {/* Status indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'success.main' }} />
              <Typography variant="body2" color="text.secondary">
                Connected
              </Typography>
              {availableDisplays.length > 1 && (
                <Chip label={`Display ${currentDisplay + 1}/${availableDisplays.length}`} size="small" />
              )}
            </Box>
          </Toolbar>
        )}

        {/* Disconnected/Error Toolbar */}
        {(status === 'disconnected' || status === 'error') && (
          <Toolbar
            variant="dense"
            sx={{
              minHeight: 36,
              backgroundColor: 'background.paper',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Button size="small" onClick={handleReconnect} startIcon={<span>🔄</span>}>
              Reconnect
            </Button>
          </Toolbar>
        )}

        <Box
          ref={containerRef}
          sx={{
            flex: 1,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: status === 'connected' ? 'flex-start' : 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {status === 'connecting' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <CircularProgress />
              <Typography>{t('Connecting to VNC console...')}</Typography>
            </Box>
          )}

          {status === 'error' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <Typography color="error">{errorMessage || t('VNC connection failed')}</Typography>
            </Box>
          )}

          {status === 'disconnected' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <Typography>{t('VNC connection closed')}</Typography>
            </Box>
          )}

          <Box
            sx={{
              flex: 1,
              display: status === 'connected' ? 'flex' : 'none',
              '& > div': {
                width: '100%',
                height: '100%',
              },
              ...getScaleStyle(),
            }}
          >
            {open && vncUrl && (
              <VncScreen
                key={reconnectKey}
                ref={vncRef}
                url={vncUrl}
                scaleViewport={scaleMode === 'fit'}
                clipViewport
                viewOnly={viewOnly}
                qualityLevel={qualityLevel}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onSecurityFailure={handleError}
                onCredentialsRequired={handleCredentialsRequired}
                style={{
                  width: '100%',
                  height: '100%',
                }}
              />
            )}
          </Box>

          {/* Touch Keyboard Overlay */}
          {status === 'connected' && touchEnabled && showTouchKeyboard && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                p: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
              }}
            >
              {TOUCH_KEYBOARD_ROWS.map((row, rowIdx) => (
                <Box key={rowIdx} sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                  {row.map(key => (
                    <Button
                      key={key}
                      size="small"
                      variant="outlined"
                      onClick={() => sendTouchChar(key)}
                      disabled={viewOnly}
                      sx={{
                        minWidth: 32,
                        height: 40,
                        color: 'white',
                        borderColor: 'rgba(255,255,255,0.3)',
                        '&:hover': {
                          borderColor: 'white',
                          backgroundColor: 'rgba(255,255,255,0.1)',
                        },
                      }}
                    >
                      {touchShiftActive ? key.toUpperCase() : key}
                    </Button>
                  ))}
                </Box>
              ))}
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                <Button
                  size="small"
                  variant={touchShiftActive ? 'contained' : 'outlined'}
                  onClick={() => setTouchShiftActive(!touchShiftActive)}
                  disabled={viewOnly}
                  sx={{
                    minWidth: 60,
                    height: 40,
                    color: touchShiftActive ? undefined : 'white',
                    borderColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  ⇧
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => sendTouchChar(' ')}
                  disabled={viewOnly}
                  sx={{
                    flex: 1,
                    maxWidth: 200,
                    height: 40,
                    color: 'white',
                    borderColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  Space
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => sendSingleKey(KeyCodes.Backspace)}
                  disabled={viewOnly}
                  sx={{
                    minWidth: 60,
                    height: 40,
                    color: 'white',
                    borderColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  ⌫
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => sendSingleKey(KeyCodes.Enter)}
                  disabled={viewOnly}
                  sx={{
                    minWidth: 60,
                    height: 40,
                    color: 'white',
                    borderColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  ↵
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
