export interface Subscription {
  status: 'active' | 'inactive' | 'expired';
  type: 'free' | 'ultimate' | 'pro';
  expiry: string | null;
}

export interface UserData {
  success: boolean;
  user_id: number;
  username: string;
  email: string;
  display_name: string;
  nonce: string;
  subscription: Subscription;
} 