import { Request, Response, NextFunction } from "express";
import { AuthenticationError } from "@dotevolve/error-utils";

// Mock supabase before importing the middleware so supabaseConfigured
// is evaluated against the mocked module at load time.
jest.mock("../../db/supabase", () => ({
  perfxcelSupabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

// Set env vars before importing auth so it assumes Supabase is configured
process.env.SUPABASE_URL = "http://localhost:8000";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

// Import after mocking and setting env vars
import { perfxcelSupabase } from "../../db/supabase";
import { requireAuth } from "../../middleware/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockReq = (authHeader?: string): Request => {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
};

const mockRes = {} as Response;

const mockNext = jest.fn() as unknown as NextFunction;

// Cast to access Jest mock methods
const getUser = perfxcelSupabase.auth.getUser as jest.Mock;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe("requireAuth", () => {
  describe("when Supabase is configured (normal operation)", () => {
    // The module was loaded with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    // set (from the environment or defaulting to empty strings checked by
    // supabaseConfigured). Since the test process inherits whatever env vars
    // are set, we test the auth logic paths directly rather than the bypass.

    it("throws AuthenticationError when Authorization header is missing", async () => {
      const req = mockReq(); // no header
      await expect(requireAuth(req, mockRes, mockNext)).rejects.toThrow(
        AuthenticationError,
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("throws AuthenticationError when Authorization header is malformed (no Bearer prefix)", async () => {
      const req = mockReq("Token some-token-value");
      await expect(requireAuth(req, mockRes, mockNext)).rejects.toThrow(
        AuthenticationError,
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("throws AuthenticationError when Supabase returns an error", async () => {
      getUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "JWT expired" },
      });

      const req = mockReq("Bearer valid.looking.token");
      await expect(requireAuth(req, mockRes, mockNext)).rejects.toThrow(
        AuthenticationError,
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("throws AuthenticationError when Supabase returns null user without error", async () => {
      getUser.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const req = mockReq("Bearer valid.looking.token");
      await expect(requireAuth(req, mockRes, mockNext)).rejects.toThrow(
        AuthenticationError,
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("calls next() and sets req.user when token is valid", async () => {
      const mockUser = { id: "user-1", email: "admin@perfxcel.net" };
      getUser.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const req = mockReq("Bearer valid.jwt.token");
      const next = jest.fn() as unknown as NextFunction;

      await requireAuth(req, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as Request & { user?: typeof mockUser }).user).toEqual(
        mockUser,
      );
      expect(getUser).toHaveBeenCalledWith("valid.jwt.token");
    });
  });

  describe("dev bypass — when Supabase is not configured", () => {
    // supabaseConfigured is evaluated at module load time, so we must reset
    // the module registry and re-import with empty env vars to test the bypass.
    it("calls next() without verifying the token when SUPABASE_URL is unset", async () => {
      const originalUrl = process.env.SUPABASE_URL;
      const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      // Unset both env vars before module reload
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      jest.resetModules();

      // Re-mock supabase after resetModules
      jest.mock("../../db/supabase", () => ({
        supabase: {
          auth: {
            getUser: jest.fn(),
          },
        },
      }));

      const {
        requireAuth: requireAuthBypass,
      } = require("../../middleware/auth");
      const { supabase: bypassSupabase } = require("../../db/supabase");
      const bypassGetUser = bypassSupabase.auth.getUser as jest.Mock;

      const req = mockReq("Bearer any-token");
      const next = jest.fn() as unknown as NextFunction;

      await requireAuthBypass(req, mockRes, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(bypassGetUser).not.toHaveBeenCalled();

      // Restore env vars
      if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
      if (originalKey !== undefined)
        process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    });
  });
});
