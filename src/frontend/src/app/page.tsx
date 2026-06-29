"use client";

import { useState } from "react";
import { Search, Network } from "lucide-react";
import styles from "./page.module.css";
import SplitPaneViewer from "../components/SplitPaneViewer";

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeEntity, setActiveEntity] = useState<string | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setActiveEntity(query.trim());
    }
  };

  const handleExample = () => {
    setQuery("Globex Corporation");
    setActiveEntity("Globex Corporation");
  };

  if (activeEntity) {
    return (
      <div className={styles.appContainer}>
        <header className={styles.header}>
          <div className={styles.headerLogo} onClick={() => setActiveEntity(null)}>
            <Network className={styles.logoIcon} size={24} suppressHydrationWarning />
            <span>Trellis Engine</span>
          </div>
          <form className={styles.headerSearch} onSubmit={handleSearch}>
            <Search size={16} color="var(--text-muted)" suppressHydrationWarning />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entity..."
              className={styles.headerSearchInput}
            />
          </form>
        </header>
        <SplitPaneViewer entity={activeEntity} />
      </div>
    );
  }

  return (
    <main className={styles.container}>
      <div className={`${styles.searchContainer} animate-fade-in`}>
        <div className={styles.logo}>
          <Network className={styles.logoIcon} size={48} suppressHydrationWarning />
          <span>Trellis Engine</span>
        </div>
        
        <form className={styles.searchBox} onSubmit={handleSearch}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search for an entity..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.searchButton}>
            <Search size={24} suppressHydrationWarning />
          </button>
        </form>

        <button className={styles.exampleButton} onClick={handleExample} type="button">
          Try an example: <strong>Globex Corporation</strong>
        </button>
      </div>
    </main>
  );
}
