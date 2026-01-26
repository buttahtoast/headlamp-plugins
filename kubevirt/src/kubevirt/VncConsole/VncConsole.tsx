import { Dialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { DialogProps } from '@mui/material';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Slider,
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

export default function VncConsole(props: VncConsoleProps) {
  const { item, onClose, open, ...other } = props;
  const { t } = useTranslation(['translation', 'glossary']);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clipboardText, setClipboardText] = useState('');
  const [sendKeysAnchor, setSendKeysAnchor] = useState<null | HTMLElement>(null);
  const [powerAnchor, setPowerAnchor] = useState<null | HTMLElement>(null);
  const [powerLoading, setPowerLoading] = useState<string | null>(null);
  const [keyboardAnchor, setKeyboardAnchor] = useState<null | HTMLElement>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [qualityLevel, setQualityLevel] = useState(6); // 0-9, higher is better
  const [reconnectKey, setReconnectKey] = useState(0);
  const vncRef = useRef<VncScreenHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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

  // Type text character by character
  const typeText = useCallback((text: string) => {
    const rfb = vncRef.current?.rfb;
    if (!rfb || !text || viewOnly) return;

    for (const char of text) {
      const code = char.charCodeAt(0);
      rfb.sendKey(code, null, true);
      rfb.sendKey(code, null, false);
    }
  }, [viewOnly]);

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
      // Wait a moment before starting
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
    // Force stop by directly stopping without graceful shutdown
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

            <Divider orientation="vertical" flexItem />

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

            <Popover
              anchorEl={settingsAnchor}
              open={Boolean(settingsAnchor)}
              onClose={() => setSettingsAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
              <Box sx={{ p: 2, minWidth: 250 }}>
                <Typography variant="subtitle2" gutterBottom>Display Settings</Typography>

                <FormControlLabel
                  control={<Switch checked={viewOnly} onChange={e => setViewOnly(e.target.checked)} size="small" />}
                  label="View Only Mode"
                />

                <Typography variant="caption" display="block" sx={{ mt: 2, mb: 1 }}>
                  Scale Mode
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant={scaleMode === 'fit' ? 'contained' : 'outlined'}
                    onClick={() => setScaleMode('fit')}
                  >
                    Fit
                  </Button>
                  <Button
                    size="small"
                    variant={scaleMode === 'actual' ? 'contained' : 'outlined'}
                    onClick={() => setScaleMode('actual')}
                  >
                    Actual
                  </Button>
                </Box>

                <Typography variant="caption" display="block" sx={{ mt: 2, mb: 1 }}>
                  Quality: {qualityLevel}
                </Typography>
                <Slider
                  size="small"
                  value={qualityLevel}
                  onChange={(_, v) => setQualityLevel(v as number)}
                  min={0}
                  max={9}
                  marks
                  valueLabelDisplay="auto"
                />
                <Typography variant="caption" color="text.secondary">
                  Lower = faster, Higher = better quality
                </Typography>
              </Box>
            </Popover>

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
        </Box>
      </DialogContent>
    </Dialog>
  );
}
