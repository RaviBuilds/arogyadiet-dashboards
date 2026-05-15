export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  original_price: number;
  sale_price: number | null;
  image_url: string[] | null;
  is_active: boolean;
  in_stock: boolean;
}

export interface CartItem extends Product {
  quantity: number;
}
