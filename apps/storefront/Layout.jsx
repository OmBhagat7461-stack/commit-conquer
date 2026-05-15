

import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { Outlet, Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";


const CartStateCtx    = createContext(null);
const CartDispatchCtx = createContext(null);

const API = "http://localhost:4000/api/store";

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [], isOpen: false });
  const derived = {
    ...state,
    count: state.items.reduce((n, i) => n + i.quantity, 0),
    total: state.items.reduce((s, i) => s + i.price * i.quantity, 0),
  };
function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [], isOpen: false });
  const derived = {
    ...state,
    count: state.items.reduce((n, i) => n + (Number(i.quantity) || 0), 0),
    total: state.items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0),
  };
  return (
    <CartStateCtx.Provider value={state}>
      <CartDispatchCtx.Provider value={dispatch}>
        {children}
      </CartDispatchCtx.Provider>
    </CartStateCtx.Provider>
  );
}

export function useCartState()    { return useContext(CartStateCtx); }
export function useCartDispatch() { return useContext(CartDispatchCtx); }



function Header() {
  const cart     = useCartState();
  const dispatch = useCartDispatch();
  const navigate = useNavigate();

  const navStyle = ({ isActive }) => ({
    textDecoration: "none",
    color: isActive ? "#7c6aff" : "#aaa",
    fontSize: 14,
    fontWeight: 500,
    transition: "color 0.15s",
  });

  return (
    <header style={s.header}>
      <Link to="/" style={s.logo}>commit&amp;conquer</Link>

      <nav style={s.nav}>
        <NavLink to="/"           end style={navStyle}>Shop</NavLink>
        <NavLink to="/collections"    style={navStyle}>Collections</NavLink>
        <NavLink to="/about"          style={navStyle}>About</NavLink>
        <NavLink to="/account"        style={navStyle}>Account</NavLink>
        {/* Admin link — for hackathon convenience */}
        <NavLink to="/admin"          style={({ isActive }) => ({
          ...navStyle({ isActive }),
          background: isActive ? "rgba(124,106,255,0.15)" : "rgba(255,255,255,0.05)",
          padding: "4px 10px", borderRadius: 6, fontSize: 13,
        })}>Admin ↗</NavLink>
      </nav>

      <button
        onClick={() => dispatch({ type: "TOGGLE_CART", payload: true })}
        style={s.cartBtn}
        aria-label="Open cart"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        {cart?.count > 0 && <span style={s.badge}>{cart.count > 99 ? "99+" : cart.count}</span>}
      </button>
    </header>
  );
}



function Footer() {
  return (
    <footer style={s.footer}>
      <div style={s.footerInner}>
        <span style={{ color: "#555", fontSize: 13 }}>© {new Date().getFullYear()} Commit &amp; Conquer</span>
        <div style={{ display: "flex", gap: 20 }}>
          <Link to="/about"       style={s.footerLink}>About</Link>
          <Link to="/collections" style={s.footerLink}>Collections</Link>
          <Link to="/account"     style={s.footerLink}>Account</Link>
        </div>
      </div>
    </footer>
  );
}



export default function Layout() {
  return (
    <div style={s.root}>
      <Header />
      <main style={s.main}>
        <Outlet />   {/* React Router renders child page here */}
      </main>
      <Footer />
    </div>
  );
}



const s = {
  root:    { minHeight: "100vh", display: "flex", flexDirection: "column", background: "#0c0c0e", color: "#e8e8f0" },
  header:  {
    position: "sticky", top: 0, zIndex: 100,
    display: "flex", alignItems: "center", gap: 24,
    padding: "0 32px", height: 60,
    background: "rgba(12,12,14,0.9)", backdropFilter: "blur(12px)",
    borderBottom: "1px solid #2a2a31",
  },
  logo:    { fontWeight: 800, fontSize: 17, textDecoration: "none", color: "#e8e8f0", letterSpacing: "-0.5px", marginRight: "auto" },
  nav:     { display: "flex", alignItems: "center", gap: 20 },
  cartBtn: {
    position: "relative", background: "none", border: "none",
    cursor: "pointer", color: "#e8e8f0", padding: "6px 8px",
    borderRadius: 8, marginLeft: 8, display: "flex", alignItems: "center",
  },
  badge:   {
    position: "absolute", top: 0, right: 0,
    background: "#7c6aff", color: "#fff",
    fontSize: 10, fontWeight: 700, borderRadius: "50%",
    width: 17, height: 17, display: "flex", alignItems: "center", justifyContent: "center",
  },
  main:    { flex: 1 },
  footer:  { borderTop: "1px solid #1c1c21", padding: "24px 32px" },
  footerInner: { maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" },
  footerLink: { color: "#555", textDecoration: "none", fontSize: 13 },
};