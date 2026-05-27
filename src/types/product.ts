export interface Product {
  id: string;
  sku: string;
  name: string;
  short_description: string | null;
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
