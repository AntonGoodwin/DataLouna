import { Request, Response } from "express";
import db from "./db";

const BAD_REQUEST_HTTP_CODE = 400;
const SERVER_ERROR_HTTP_CODE = 500;


export const purchase = async (req: Request, res: Response) => {
  const { productId } = req.body;
  // @ts-ignore
  const userId = req.user.id;

  const [product] = await db`SELECT * FROM products WHERE id = ${productId}`;

  if (!product) {
    return res.status(BAD_REQUEST_HTTP_CODE).json({ error: 'Internal Server Error' });
  }

  try {
    await db.begin(async sql => {
      await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      
      const [{ balance }] = await sql`
        SELECT SUM(amount) AS balance 
        FROM transactions WHERE user_id = ${userId}`;

      if (balance < product.price) {
        throw new Error('Insufficient balance');
      }

      await sql`INSERT INTO transactions (user_id, amount) VALUES (${userId}, ${-product.price})`;
      await sql`INSERT INTO purchases (user_id, product_id) VALUES (${userId}, ${productId})`;
    });

    const [{ newBalance }] = await db`
      SELECT SUM(amount) AS newBalance 
      FROM transactions WHERE user_id = ${userId}`;

    res.json({ balance: newBalance });
  } catch (error) {
    res.status(SERVER_ERROR_HTTP_CODE).json({ error: 'Internal Server Error' });
  }
};
