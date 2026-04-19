import { backupRealSnapshots } from "./fixtures";

export default async function globalSetup(): Promise<void> {
  backupRealSnapshots();
}
