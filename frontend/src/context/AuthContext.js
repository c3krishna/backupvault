// frontend/src/context/AuthContext.js
import { createContext, useContext, useState, useCallback } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children, onPreferences }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bv_user')); } catch { return null; }
  });

  const login = useCallback(async (email, password) => {
    const data = await authAPI.login(email, password);
    localStorage.setItem('bv_token', data.token);
    localStorage.setItem('bv_user', JSON.stringify(data.user));
    setUser(data.user);
    // Apply preferences (theme etc.) returned from login response
    if (data.preferences && onPreferences) {
      onPreferences(data.preferences);
    }
    return data;
  }, [onPreferences]);

  const logout = useCallback(() => {
    localStorage.removeItem('bv_token');
    localStorage.removeItem('bv_user');
    localStorage.removeItem('bv_theme');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
