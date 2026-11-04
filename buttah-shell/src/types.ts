export type ShellPrefs = {
  issuerUrl: string;
  clientId: string;
  scopes: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  image: string;
  namespace: string;
  idpCaPem: string;
};

export type ButtahPrefs = {
  organization: string;
  homeRegion: string;
  shell: ShellPrefs;
  /** Namespace written into a downloaded kubeconfig context. Empty until chosen. */
  contextNamespace: string;
};
