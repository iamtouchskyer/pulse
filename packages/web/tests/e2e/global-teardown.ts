import { restoreRealSnapshots } from "./fixtures";

export default async function globalTeardown(): Promise<void> {
  restoreRealSnapshots();
}
