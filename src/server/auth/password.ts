import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// argon2id é o algoritmo padrão do @node-rs/argon2.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const passwordSchema = z.string().min(10).max(128);

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Hash descartável para igualar o tempo de resposta quando o usuário não existe. */
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword("senha-descartavel-para-tempo-constante"));
}
