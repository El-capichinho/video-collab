import { z } from "zod";

/** Request/response contracts for the auth API. Shared so the browser can
 *  validate before sending and the server can validate on arrival. */

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email address is too long");

export const Password = z
  .string()
  .min(10, "Use at least 10 characters for your password")
  .max(128, "Passwords can be up to 128 characters");

export const DisplayName = z
  .string()
  .trim()
  .min(1, "Enter the name others will see")
  .max(40, "Names can be up to 40 characters");

export const RegisterBody = z.object({ email: Email, password: Password, displayName: DisplayName });
export type RegisterBody = z.infer<typeof RegisterBody>;

// Login accepts any non-empty password so accounts made under older rules still work.
export const LoginBody = z.object({
  email: Email,
  password: z.string().min(1, "Enter your password").max(128, "Passwords can be up to 128 characters"),
});
export type LoginBody = z.infer<typeof LoginBody>;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
