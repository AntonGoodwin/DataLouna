# DataLouna

> К сожалению на данный момент сложности 
> с свободным временем поэтому, что бы не затягивать
> с тестовым заданием решил сделать его в формате
> код-сниппетов с пояснениями.


## Задание 1
Добавил в схему sessions таблицу для хранения сессий пользователей, в этой таблице так же можно хранить мета данные о сессии (например IP адрес логина). Добавил индекс на username и expires_at, для быстрого поиска юзеров и сессий.

Схема БД
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL
);

CREATE TABLE purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_purchases_user_id ON purchases(user_id);
```


### Регистрация ([КОД](/src/task_1.ts))
Cделал валидацию входящих данных, проверку юзера на существование и сохранение юзера в БД с хэщированным паролем.
```typescript
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
```

### Авторизация ([КОД](/src/task_1.ts))
Сделал минимальную валидацию входящих данных, проверку сравение пароля по хэшу с создание сессии в БД если все успешно и добавляем в куки ИД сессии. При наличие большого количества пользователей, можно также класть сессию в Redis с ключом типа `session:[session ID]` и EX установленным на время жизни сессии. Соответственно при проверке авторизации будем ходить не в БД и в Redis, и при это сохраним в БД лог сессий пользователей.
```typescript
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
```

### Смена пароля ([КОД](/src/task_1.ts))
Сделал стандартную смену пароля c валидцией и инвалидцией. Так же если необходимо кеширование в Redis, упомянутое в авторизации, то также нужно будет "заинвалидировать" кеш.
```typescript
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
      return res.status(BAD_REQUEST_HTTP_CODE).json({ message: 'Old password is incorrect' });
    }
    
    if (bcrypt.compareSync(newPassword, user.password)) {
      return res.status(BAD_REQUEST_HTTP_CODE).json({ message: 'New password matches old password' });
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
};
```


## Задание 2
Данный ендпоинт кешируется на 5 минут, следовательные данные в нем обновляються крайне редко и есть смысл кешировать респонс от АПИ на 5 или более минут. Так же имеет смысл отдавать респонс из кэша и только потом проверять его TTL и инвалидировать при необходимости. И описание АПИ не полное, но предположу, что tradable = FALSE возвращает только НЕ tradable продукты.

### Получение минимальных прайсов из Skinport ([КОД](/src/task_2.ts))
```typescript
export const getSkinportProducts = async (_req: Request, res: Response) => {
  try {
    const cachedData = await redisClient.get(ITEM_PRICES_CACHE_KEY);

    if (cachedData) {
      const data = JSON.parse(cachedData);
      res.json(data.items);

      if (data.ttl < Date.now()) {
        refetchDataFromApiAndSetCache();
      }
      return;
    }

    const minimalPrices = await refetchDataFromApiAndSetCache();
    return res.json(minimalPrices);
  } catch (err) {
    res.status(SERVER_ERROR_HTTP_CODE).json({ error: "Internal server error" });
  }
};
```

## Задание 3
Баланс я не стал хранить числом в таблице users (хотя в реально жизни все же можно положить его дополнительно в users, что бы не вычислять его каждый раз для отображения на UI), а вычисляю динмачески на основе таблицы transactions (транзакции пополнения балансов пользвателей и списания баланса за покупку продуктов). Так же в реальной жизни нужно было бы создать связывающую таблицу для products и purchases, так как в одном заказе может быть несколько продуктов. И нужно обернуть покупку в транзакцию что бы избежать проблем с проверкой баланса.

### Покупка товара ([КОД](/src/task_3.ts))
```typescript
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
```
