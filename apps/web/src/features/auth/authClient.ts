import { AuthClient } from "../../core/auth/AuthClient";
import { SERVER_URL } from "../../core/config";

/** One AuthClient for the whole app, so refreshes are shared. */
export const authClient = new AuthClient(SERVER_URL);
