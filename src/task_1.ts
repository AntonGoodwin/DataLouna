import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { z } from "zod";
import db from "./db";

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z
    .string()
    .min(9, "Password must be at least 6 characters")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/\d/, "Password must contain at least one number")
    .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
});
const loginSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(9, "Password must be at least 6 characters"),
});
const changePasswordSchema = z.object({
  newPassword: z
    .string()
    .min(9, "Password must be at least 6 characters")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/\d/, "Password must contain at least one number")
    .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character"),
  oldPassword: z.string().min(9, "Password must be at least 6 characters"),
});
const SUCCESS_HTTP_CODE = 200;
const CREATED_HTTP_CODE = 201;
const BAD_REQUEST_HTTP_CODE = 400;
const UNAUTHORIZED_HTTP_CODE = 401;
const NOT_FOUND_HTTP_CODE = 404;
const CONFLICT_HTTP_CODE = 409;
const SERVER_ERROR_HTTP_CODE = 500;


export const register = async (req: Request, res: Response) => {
  try {
    const { username, password } = registerSchema.parse(req.body);

    const existingUser = await db`SELECT id FROM users WHERE username = ${username}`;

    if (existingUser.length > 0) {
      return res.status(CONFLICT_HTTP_CODE).json({ error: "User already exists" });
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    await db`INSERT INTO users (username, password) VALUES (${username}, ${hashedPassword})`;
    res.status(CREATED_HTTP_CODE).json({});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(BAD_REQUEST_HTTP_CODE).json({ error: err.errors.map(e => e.message) });
    }
    console.error("DB Error:", err);
    res.status(SERVER_ERROR_HTTP_CODE).json({ error: "Internal server error" });
  }
};


export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = await db`SELECT id, password FROM users WHERE username = ${username}`;

    if (user.length === 0) {
      return res.status(UNAUTHORIZED_HTTP_CODE).json({ error: "Invalid username or password" });
    }

    if (!bcrypt.compareSync(password, user[0].password)) {
      return res.status(UNAUTHORIZED_HTTP_CODE).json({ error: "Invalid credentials" });
    }

    const sessionID = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${sessionID}, ${user[0].id}, ${expiresAt})`;

    res.cookie("sessionID", sessionID, { httpOnly: true, secure: true, sameSite: "strict" });
    res.status(SUCCESS_HTTP_CODE).json({});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(BAD_REQUEST_HTTP_CODE).json({ error: err.errors.map(e => e.message) });
    }
    console.error("DB Error:", err);
    res.status(SERVER_ERROR_HTTP_CODE).json({ error: "Internal server error" });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);

    // @ts-ignore
    const userId = req.user.id;

    const userResult = await db`SELECT id, password FROM users WHERE id = ${userId}`;

    if (userResult.length === 0) {
      return res.status(NOT_FOUND_HTTP_CODE).json({ error: "User not found" });
    }

    const user = userResult[0];

    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(BAD_REQUEST_HTTP_CODE).json({ error: 'Old password is incorrect' });
    }

    if (bcrypt.compareSync(newPassword, user.password)) {
      return res.status(BAD_REQUEST_HTTP_CODE).json({ error: 'New password matches old password' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedNewPassword = bcrypt.hashSync(newPassword, salt);

    await db`
    UPDATE users SET password = ${hashedNewPassword} WHERE id = ${user.id}`;
    await db`
    UPDATE sessions SET expires_at = now() WHERE user_id = ${user.id} AND expires_at > now()`;

    res.status(SUCCESS_HTTP_CODE).json({});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(BAD_REQUEST_HTTP_CODE).json({ error: err.errors.map(e => e.message) });
    }
    res.status(SERVER_ERROR_HTTP_CODE).json({ error: "Internal server error" });
  }
}
