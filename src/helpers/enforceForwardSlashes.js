export default function enforceForwardSlashes(pathname) {
  return pathname.replace(/(\\\\|\\)/g, '/');
}
