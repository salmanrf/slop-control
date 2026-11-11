import { createRunUser } from './user';

export default async function globalSetup(): Promise<void> {
  await createRunUser();
}
