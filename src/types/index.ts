export type UserRole = 'admin' | 'manager' | 'staff';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  storeId: string | null;
  active: boolean;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  managerId: string | null;
  active: boolean;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  categoryId: string;
  unit: string;
  costPrice: number;
  transferPrice: number;
  salePrice: number;
  supplierId: string | null;
  safetyStock: number;
  active: boolean;
  createdAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  active: boolean;
}

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'shipped'
  | 'received'
  | 'closed';

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  approvedQuantity: number;
  receivedQuantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Order {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  status: OrderStatus;
  items: OrderItem[];
  totalAmount: number;
  note: string;
  createdBy: string;
  createdAt: number;
  submittedAt: number | null;
  approvedBy: string | null;
  approvedAt: number | null;
  shippedAt: number | null;
  receivedAt: number | null;
}
