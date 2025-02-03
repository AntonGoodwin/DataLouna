import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { z } from "zod";
import axios from 'axios';
import redis from 'redis';

type Product = {
  market_hash_name: string;
  min_price: number;
};

type MinPrice = {
  name: string;
  tradable_min_price: number;
  not_tradable_min_price?: number;
};

const CACHE_TTL_1H_MS = 60 * 60 * 1000;
const ITEM_PRICES_CACHE_KEY = 'skinport_items_min_prices';
const SUCCESS_HTTP_CODE = 200;
const CREATED_HTTP_CODE = 201;
const BAD_REQUEST_HTTP_CODE = 400;
const UNAUTHORIZED_HTTP_CODE = 401;
const NOT_FOUND_HTTP_CODE = 404;
const CONFLICT_HTTP_CODE = 409;
const SERVER_ERROR_HTTP_CODE = 500;
const SKINPORT_API_HOST = process.env.SKINPORT_API_HOST || 'https://api.skinport.com';

const redisClient = redis.createClient();
redisClient.connect();

const fetchItemsFromAPI = async (isTradable: boolean): Promise<Product[]> => {
  const response = await axios.get<Product[]>(`${SKINPORT_API_HOST}/items`, {
    params: {
      tradable: isTradable
    }
  });
  return response.data;
};

const parseMinimalPrices = (tradableProducts: Product[], noteTradableProducts: Product[]): MinPrice[] => {
  return tradableProducts.reduce((acc: MinPrice[], product: Product) => {
    const noteTradableProduct = noteTradableProducts.find((item: Product) => item.market_hash_name === product.market_hash_name);
    acc.push({
      name: product.market_hash_name,
      tradable_min_price: product.min_price,
      not_tradable_min_price: noteTradableProduct?.min_price
    })
    return acc;
  }, []);
};

const refetchDataFromApiAndSetCache = async (): Promise<MinPrice[]> => {
  const tradableProducts = await fetchItemsFromAPI(true);
  const noteTradableProducts = await fetchItemsFromAPI(false);
  const minimalPrices = parseMinimalPrices(tradableProducts, noteTradableProducts);
  redisClient.set(ITEM_PRICES_CACHE_KEY, JSON.stringify({
    items: minimalPrices,
    ttl: Date.now() + CACHE_TTL_1H_MS
  }));
  return minimalPrices;
}

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
