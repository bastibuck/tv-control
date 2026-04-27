export {};

declare global {
  interface Window {
    netflix?: {
      appContext?: {
        state?: {
          playerApp?: {
            getAPI?: () => {
              videoPlayer?: {
                getAllPlayerSessionIds?: () => string[];
                getVideoPlayerBySessionId?: (sessionId: string) => {
                  seek?: (timeMs: number) => void;
                  getCurrentTime?: () => number;
                };
              };
            };
          };
        };
      };
    };
  }
}
