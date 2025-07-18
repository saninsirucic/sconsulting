import React from "react";
import { useNavigate } from "react-router-dom";
import { BACKEND_URL } from "./config";

function Home() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: 20 }}>
      <h1>Početna stranica</h1>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => navigate("/klijenti")}>Klijenti</button>
        <button onClick={() => navigate("/izvodjaci")}>Izvođači</button>
        <button onClick={() => navigate("/planovi")}>Planovi</button>
        <button onClick={() => navigate("/fakture")}>Fakture</button>
        <button onClick={() => navigate("/kuf")}>KUF</button>
        <button onClick={() => navigate("/sanitarne-knjizice")}>Sanitarne knjižice</button>
      </div>
    </div>
  );
}

export default Home;
