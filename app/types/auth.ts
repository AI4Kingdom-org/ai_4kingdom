interface Subscription {
  status: 'active' | 'inactive' | 'expired';
  type: 'free' | 'premium' | 'enterprise';
  expiry: string | null;
}

interface UserData {
  success: boolean;
  user_id: number;
  username: string;
  email: string;
  display_name: string;
  nonce: string;
  subscription: Subscription;
} 