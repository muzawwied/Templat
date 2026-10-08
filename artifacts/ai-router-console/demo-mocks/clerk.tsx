// DEMO MOCK — menggantikan @clerk/react saat build halaman demo statis.
// File ini TIDAK bagian dari source template; hanya dipakai lewat alias vite
// saat membangun pratinjau publik. Jangan di-commit ke repo.
import type { ReactNode } from 'react';

export function ClerkProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function SignIn() {
  return <div className="panel">Demo console: autentikasi dinonaktifkan.</div>;
}

export function SignUp() {
  return <div className="panel">Demo console: autentikasi dinonaktifkan.</div>;
}

export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: 'user_demo' };
}

export function useUser() {
  return {
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'user_demo',
      firstName: 'Vylonium',
      lastName: '',
      fullName: 'Vylonium',
      primaryEmailAddress: { emailAddress: 'vylonium@clincoo.buzz' },
    },
  };
}

export function useClerk() {
  return {
    signOut: async () => {},
    openUserProfile: () => {},
  };
}
