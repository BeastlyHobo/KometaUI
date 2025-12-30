import { useState } from "react";

import { useAuth } from "../state/auth";

export default function AuthPrompt() {
  const { requiredMode, setBasicAuth, setTokenAuth, clearAuth, authState } = useAuth();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [token, setToken] = useState("");

  if (!requiredMode) {
    return null;
  }

  return (
    <div className="auth-panel">
      <div>
        <h2>Authentication required</h2>
        <p>
          The API requires {requiredMode === "basic" ? "basic auth" : "a bearer token"}.
        </p>
      </div>
      {requiredMode === "basic" ? (
        <div className="auth-fields">
          <input
            placeholder="Username"
            value={user}
            onChange={(event) => setUser(event.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={pass}
            onChange={(event) => setPass(event.target.value)}
          />
          <button className="primary" onClick={() => setBasicAuth(user, pass)}>
            Save Credentials
          </button>
        </div>
      ) : (
        <div className="auth-fields">
          <input
            placeholder="Bearer token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button className="primary" onClick={() => setTokenAuth(token)}>
            Save Token
          </button>
        </div>
      )}
      {authState.mode !== "none" && (
        <button className="ghost" onClick={() => clearAuth()}>
          Clear stored auth
        </button>
      )}
    </div>
  );
}
