export const ROLES = ["owner", "manager", "attendant"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "billing:manage"
  | "team:manage"
  | "settings:edit"
  | "catalog:edit"
  | "orders:manage"
  | "stock:edit";

const MATRIX: Record<Role, readonly Action[]> = {
  owner: ["billing:manage", "team:manage", "settings:edit", "catalog:edit", "orders:manage", "stock:edit"],
  manager: ["settings:edit", "catalog:edit", "orders:manage", "stock:edit"],
  attendant: ["orders:manage", "stock:edit"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].includes(action);
}
