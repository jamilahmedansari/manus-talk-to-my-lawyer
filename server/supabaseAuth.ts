/**
 * Supabase Auth Module
 * 
 * Handles server-side authentication using Supabase Auth:
 * - JWT verification from Authorization header or cookie
 * - User creation/sync between Supabase auth.users and app users table
 * - Admin operations using service_role key
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response, Express } from "express";
import * as db from "./db";
import type { User } from "../drizzle/schema";
import { getSessionCookieOptions } from "./_core/cookies";

// ─── Supabase Clients ──────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

// Admin client (service_role) — bypasses RLS, used for JWT verification and admin ops
let adminClient: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("[SupabaseAuth] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

// ─── Session Cookie ────────────────────────────────────────────────────────
const SUPABASE_SESSION_COOKIE = "sb_session";

// ─── JWT Verification ──────────────────────────────────────────────────────
/**
 * Extract the Supabase access token from the request.
 * Checks: Authorization header → sb_session cookie → legacy app_session_id cookie
 */
function extractAccessToken(req: Request): string | null {
  // 1. Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. Supabase session cookie
  const cookies = parseCookies(req.headers.cookie);
  const sbSession = cookies.get(SUPABASE_SESSION_COOKIE);
  if (sbSession) {
    try {
      const parsed = JSON.parse(sbSession);
      return parsed.access_token || null;
    } catch {
      return sbSession; // Might be the raw token
    }
  }

  return null;
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  if (!cookieHeader) return new Map();
  const map = new Map<string, string>();
  cookieHeader.split(";").forEach(pair => {
    const [key, ...rest] = pair.split("=");
    if (key) {
      map.set(key.trim(), decodeURIComponent(rest.join("=").trim()));
    }
  });
  return map;
}

/**
 * Verify a Supabase JWT and return the authenticated user from our app database.
 * Creates the user in our app database if they don't exist yet.
 */
export async function authenticateRequest(req: Request): Promise<User | null> {
  const token = extractAccessToken(req);
  if (!token) return null;

  try {
    const admin = getAdminClient();
    // Verify the JWT using Supabase Admin API
    const { data: { user: supabaseUser }, error } = await admin.auth.getUser(token);
    
    if (error || !supabaseUser) {
      console.warn("[SupabaseAuth] JWT verification failed:", error?.message);
      return null;
    }

    const supabaseUid = supabaseUser.id;
    const email = supabaseUser.email || null;
    const name = supabaseUser.user_metadata?.name || 
                 supabaseUser.user_metadata?.full_name || 
                 email?.split("@")[0] || 
                 null;

    // Check if user exists in our app database
    let appUser = await db.getUserByOpenId(supabaseUid);

    if (!appUser) {
      // First login — create user in app database
      // Check if this is the owner (admin)
      const ownerOpenId = process.env.OWNER_OPEN_ID;
      const isOwner = ownerOpenId && (supabaseUid === ownerOpenId || email === ownerOpenId);
      
      await db.upsertUser({
        openId: supabaseUid,
        name,
        email,
        loginMethod: supabaseUser.app_metadata?.provider || "email",
        lastSignedIn: new Date(),
        ...(isOwner ? { role: "admin" } : {}),
      });
      appUser = await db.getUserByOpenId(supabaseUid);
    } else {
      // Update last sign-in
      await db.upsertUser({
        openId: supabaseUid,
        lastSignedIn: new Date(),
      });
    }

    return appUser || null;
  } catch (err) {
    console.error("[SupabaseAuth] Authentication error:", err);
    return null;
  }
}

// ─── Express Auth Routes ───────────────────────────────────────────────────
export function registerSupabaseAuthRoutes(app: Express) {
  
  // POST /api/auth/signup — Create a new user via Supabase Auth
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }

      const admin = getAdminClient();
      
      // Create user in Supabase Auth
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm for now (no email verification)
        user_metadata: { name: name || email.split("@")[0] },
      });

      if (error) {
        console.error("[SupabaseAuth] Signup error:", error.message);
        if (error.message.includes("already been registered") || error.message.includes("already exists")) {
          res.status(409).json({ error: "An account with this email already exists. Please sign in instead." });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }

      if (!data.user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }

      // Create user in our app database
      const ownerOpenId = process.env.OWNER_OPEN_ID;
      const isOwner = ownerOpenId && (data.user.id === ownerOpenId || email === ownerOpenId);
      
      await db.upsertUser({
        openId: data.user.id,
        name: name || email.split("@")[0],
        email,
        loginMethod: "email",
        lastSignedIn: new Date(),
        ...(isOwner ? { role: "admin" } : {}),
      });

      // Now sign them in to get a session
      // We use the admin client to generate tokens directly
      const { data: signInData, error: signInError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      // Sign in with email/password to get session tokens
      // Create a temporary anon client to sign in
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      
      const { data: sessionData, error: sessionError } = await anonClient.auth.signInWithPassword({
        email,
        password,
      });

      if (sessionError || !sessionData.session) {
        // User was created but session failed — they can still log in
        console.warn("[SupabaseAuth] Session creation after signup failed:", sessionError?.message);
        res.status(201).json({ 
          success: true, 
          message: "Account created. Please sign in.",
          needsLogin: true,
        });
        return;
      }

      // Set session cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(SUPABASE_SESSION_COOKIE, JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      }), {
        ...cookieOptions,
        maxAge: sessionData.session.expires_in * 1000,
      });

      res.status(201).json({
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          name: name || email.split("@")[0],
        },
        session: {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
          expires_in: sessionData.session.expires_in,
        },
      });
    } catch (err) {
      console.error("[SupabaseAuth] Signup error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/auth/login — Sign in with email/password
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      // Use anon client for sign-in
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await anonClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("[SupabaseAuth] Login error:", error.message);
        if (error.message.includes("Invalid login credentials")) {
          res.status(401).json({ error: "Invalid email or password" });
          return;
        }
        res.status(401).json({ error: error.message });
        return;
      }

      if (!data.session || !data.user) {
        res.status(401).json({ error: "Authentication failed" });
        return;
      }

      // Sync user to app database
      const name = data.user.user_metadata?.name || 
                   data.user.user_metadata?.full_name || 
                   email.split("@")[0];
      
      await db.upsertUser({
        openId: data.user.id,
        name,
        email,
        loginMethod: data.user.app_metadata?.provider || "email",
        lastSignedIn: new Date(),
      });

      // Set session cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(SUPABASE_SESSION_COOKIE, JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }), {
        ...cookieOptions,
        maxAge: data.session.expires_in * 1000,
      });

      res.json({
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          name,
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
        },
      });
    } catch (err) {
      console.error("[SupabaseAuth] Login error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/auth/logout — Sign out
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const token = extractAccessToken(req);
      if (token) {
        const admin = getAdminClient();
        // Get user to sign them out
        const { data: { user } } = await admin.auth.getUser(token);
        if (user) {
          await admin.auth.admin.signOut(user.id);
        }
      }

      // Clear session cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(SUPABASE_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      // Also clear legacy Manus cookie if present
      res.clearCookie("app_session_id", { ...cookieOptions, maxAge: -1 });

      res.json({ success: true });
    } catch (err) {
      console.error("[SupabaseAuth] Logout error:", err);
      // Still clear cookies even if Supabase call fails
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(SUPABASE_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      res.clearCookie("app_session_id", { ...cookieOptions, maxAge: -1 });
      res.json({ success: true });
    }
  });

  // POST /api/auth/refresh — Refresh the access token
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const sbSession = cookies.get(SUPABASE_SESSION_COOKIE);
      
      if (!sbSession) {
        res.status(401).json({ error: "No session found" });
        return;
      }

      let refreshToken: string;
      try {
        const parsed = JSON.parse(sbSession);
        refreshToken = parsed.refresh_token;
      } catch {
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      if (!refreshToken) {
        res.status(401).json({ error: "No refresh token" });
        return;
      }

      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });

      if (error || !data.session) {
        res.status(401).json({ error: "Session expired. Please sign in again." });
        return;
      }

      // Update cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(SUPABASE_SESSION_COOKIE, JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }), {
        ...cookieOptions,
        maxAge: data.session.expires_in * 1000,
      });

      res.json({
        success: true,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
        },
      });
    } catch (err) {
      console.error("[SupabaseAuth] Refresh error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/auth/forgot-password — Send password reset email
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error } = await anonClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${req.headers.origin || "http://localhost:3000"}/reset-password`,
      });

      if (error) {
        console.error("[SupabaseAuth] Password reset error:", error.message);
      }

      // Always return success to prevent email enumeration
      res.json({ success: true, message: "If an account exists with this email, a password reset link has been sent." });
    } catch (err) {
      console.error("[SupabaseAuth] Forgot password error:", err);
      res.json({ success: true, message: "If an account exists with this email, a password reset link has been sent." });
    }
  });

  // POST /api/auth/reset-password — Reset password with token
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { access_token, refresh_token, password } = req.body;
      
      if (!password || password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }

      if (!access_token) {
        res.status(400).json({ error: "Invalid or expired reset link" });
        return;
      }

      // Create a client with the user's session from the reset link
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Set the session from the reset link tokens
      await userClient.auth.setSession({
        access_token,
        refresh_token: refresh_token || "",
      });

      const { error } = await userClient.auth.updateUser({ password });

      if (error) {
        console.error("[SupabaseAuth] Password update error:", error.message);
        res.status(400).json({ error: "Failed to reset password. The link may have expired." });
        return;
      }

      res.json({ success: true, message: "Password has been reset successfully." });
    } catch (err) {
      console.error("[SupabaseAuth] Reset password error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
