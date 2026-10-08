declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
interface Window {
  readonly screenstash: { readonly appName: string };
}
