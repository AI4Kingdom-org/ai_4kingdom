export interface Subscription {
  status: 'active' | 'inactive' | 'expired';
  type: 'free' | 'ultimate' | 'pro';
  expiry: string | null;
}

export interface UserData {
  user_id: string;
  subscription?: {
    type: string;
  };
  nonce?: string;
  success: boolean;
} 