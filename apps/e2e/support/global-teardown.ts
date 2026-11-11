import { deleteRunUser } from './user';

export default async function globalTeardown(): Promise<void> {
  await deleteRunUser();
}
