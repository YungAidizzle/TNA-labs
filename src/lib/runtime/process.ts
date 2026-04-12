export function isProcessAlive(pid: number | null | undefined) {
  if (!Number.isInteger(pid) || !pid || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
