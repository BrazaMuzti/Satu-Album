import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Create from "./Create";
import Camera from "./Camera";
import Gallery from "./Gallery";

function Home() {
  return (
    <div className="home">
      <header className="hero">
        <div className="hero-inner">
          <h1 className="brand">satu-album</h1>
          <p>Kamera sekali pakai digital. Buat galeri, bagikan link, biarkan tamu memotret dengan warna film analog.</p>
          <Link to="/create" className="btn big">Buat album →</Link>
        </div>
      </header>
      <section className="features">
        <div><h2>📷</h2><p>Kamera live via browser, tanpa aplikasi.</p></div>
        <div><h2>🎞️</h2><p>6 preset warna film analog.</p></div>
        <div><h2>🔗</h2><p>Link galeri untuk dibagikan ke tamu.</p></div>
      </section>
      <footer>Made for a wedding, one more time.</footer>
    </div>
  );
}

/* BASE_URL = "/" (dev local / Vercel) atau "/Satu-Album/" (GitHub Pages project site).
   Router memakai base yang sama agar route seperti /events/<slug> tetap cocok. */
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export default function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/events/:slug/camera" element={<Camera />} />
        <Route path="/events/:slug" element={<Gallery />} />
      </Routes>
    </BrowserRouter>
  );
}