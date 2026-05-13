import { create } from "zustand";
import { CartItem, Product } from "@/types/product";
interface CartStore {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  cartTotal: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  addItem: (product) =>
    set((state) => {
      const existingItem = state.items.find((item) => item.id === product.id);
      if (existingItem) {
        return {
          items: state.items.map((item) =>
            item.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          ),
        };
      }
      return {
        items: [...state.items, { ...product, quantity: 1 }],
      };
    }),
  removeItem: (productId) => {},
  clearCart: () => set({ items: [] }),
  cartTotal: () => 50,
}));

// import { create } from "zustand";
// import { CartItem, Product } from "@/types/product";

// interface CartStore {
//   items: CartItem[];
//   addItem: (product: Product) => void;
//   removeItem: (productId: string) => void;
//   clearCart: () => void;
//   cartTotal: () => number;
// }

// export const useCartStore = create<CartStore>((set, get) => ({
//   items: [],

//   addItem: (product) =>
//     set((state) => {
//       const existingItem = state.items.find((item) => item.id === product.id);

//       if (existingItem) {
//         return {
//           items: state.items.map((item) =>
//             item.id === product.id
//               ? { ...item, quantity: item.quantity + 1 }
//               : item,
//           ),
//         };
//       }

//       return {
//         items: [...state.items, { ...product, quantity: 1 }],
//       };
//     }),

//   removeItem: (productId) =>
//     set((state) => {
//       const existingItem = state.items.find((item) => item.id === productId);

//       if (!existingItem) {
//         return state;
//       }

//       if (existingItem.quantity <= 1) {
//         return {
//           items: state.items.filter((item) => item.id !== productId),
//         };
//       }

//       return {
//         items: state.items.map((item) =>
//           item.id === productId
//             ? { ...item, quantity: item.quantity - 1 }
//             : item,
//         ),
//       };
//     }),

//   clearCart: () => set({ items: [] }),

//   cartTotal: () => {
//     const { items } = get();
//     return items.reduce((total, item) => {
//       const unitPrice = item.sale_price ?? item.original_price;
//       return total + unitPrice * item.quantity;
//     }, 0);
//   },
// }));
