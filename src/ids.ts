export function createClientMessageId(): string {
  let timestamp = Date.now();
  let highResolutionTime =
    typeof performance === 'undefined' ? 0 : performance.now() * 1000;

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    let random = Math.random() * 16;

    if (timestamp > 0) {
      random = (timestamp + random) % 16;
      timestamp = Math.floor(timestamp / 16);
    } else {
      random = (highResolutionTime + random) % 16;
      highResolutionTime = Math.floor(highResolutionTime / 16);
    }

    const value = token === 'x' ? random : (random % 4) + 8;
    return Math.floor(value).toString(16);
  });
}
