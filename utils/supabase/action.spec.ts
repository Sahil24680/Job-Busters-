import {
  login,
  signup,
  updatePassword,
  updateName,
  getUser,
  request_lock_and_tokens,
  release_request_lock,
} from "./action";


// mock redirect from next/navigation
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

const mockFrom = {
  update: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(),
  single: jest.fn(),
};

const mockAuth = {
  signInWithPassword: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
  updateUser: jest.fn(),
  getUser: jest.fn(),
};

//  mock Supabase client
const mockSupabase = {
  auth: mockAuth,
  from: jest.fn(() => mockFrom),
  storage: {
    from: jest.fn(() => ({
      upload: jest.fn().mockResolvedValue({ error: null }),
      getPublicUrl: jest.fn(() => ({ data: { publicUrl: "url" } })),
    })),
  },
};

jest.mock("./client", () => ({
  createClient: jest.fn(() => mockSupabase),
}));

describe("actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ✅ login
  test("login success", async () => {
    mockAuth.signInWithPassword.mockResolvedValueOnce({ error: null });
    const form = new FormData();
    form.append("email", "a@test.com");
    form.append("password", "1234");
    const res = await login(form);
    expect(res).toEqual({ success: true });
  });

  // ✅ signup
  test("signup success", async () => {
    mockAuth.signUp.mockResolvedValueOnce({ error: null });
    const form = new FormData();
    form.append("email", "a@test.com");
    form.append("password", "1234");
    const res = await signup(form);
    expect(res).toEqual({ success: true });
  });

  // ✅ updatePassword
  test("updatePassword error", async () => {
    mockAuth.updateUser.mockResolvedValueOnce({ error: { message: "fail" } });
    const res = await updatePassword("abc");
    expect(res).toEqual({ error: { message: "fail" } });
  });

  // ✅ updateName
  test("updateName success", async () => {
    mockFrom.update.mockReturnThis();
    mockFrom.eq.mockResolvedValueOnce({ error: null });
    const res = await updateName("John", "Doe");
    expect(res).toEqual({ success: true });
  });

  // ✅ getUser
  test("getUser success", async () => {
    mockAuth.getUser.mockResolvedValueOnce({
      data: { user: { id: "123" } },
      error: null,
    });
    const res = await getUser();
    expect(res).toEqual({ id: "123" });
  });

  // ✅ request_lock_and_tokens (new row created)
  test("request_lock_and_tokens new row", async () => {
    // return an object (not undefined) from maybeSingle
    mockFrom.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockFrom.insert.mockReturnThis();
    mockFrom.select.mockReturnThis();
    mockFrom.single.mockResolvedValueOnce({
      data: { is_available: true, tokens_remaining: 3 },
      error: null,
    });

    const res = await request_lock_and_tokens("u1");
    expect(res).toEqual({ is_available: true, tokens: 3 });
  });

  // ✅ release_request_lock
  test("release_request_lock success", async () => {
    mockFrom.update.mockReturnThis();
    mockFrom.eq.mockResolvedValueOnce({ error: null });
    await expect(release_request_lock("u1")).resolves.toBeUndefined();
  });
});