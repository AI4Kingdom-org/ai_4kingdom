export interface Subscription {
  status: 'active' | 'inactive';
  type: string;
  expiry: string | null;
}

export interface UserData {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  subscription: Subscription;
  nonce?: string;
  success: boolean;
}

export interface AuthState {
  user: UserData | null;
  loading: boolean;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  checkAuth: () => Promise<void>;
  getSubscriptionStatus: () => 'active' | 'inactive';
  getSubscriptionType: () => string;
  isSubscriptionValid: () => boolean;
} 