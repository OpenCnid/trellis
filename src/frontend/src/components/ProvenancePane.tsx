"use client";
import { useEffect, useRef } from "react";
import styles from "./SplitPaneViewer.module.css";

export default function ProvenancePane({ provenance, activeNodeIds }: { provenance: any[], activeNodeIds: Set<string> }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll to the first active node
    if (activeNodeIds.size > 0 && containerRef.current) {
      const activeEl = containerRef.current.querySelector(`.${styles.activeParagraph}`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeNodeIds]);

  if (provenance.length === 0) {
    return <div className={styles.centerMessage}>No provenance data available.</div>;
  }

  return (
    <div className={styles.provenanceContainer} ref={containerRef}>
      {provenance.map(item => {
        const isActive = activeNodeIds.has(item.id);
        return (
          <div 
            key={item.id} 
            className={`${styles.paragraph} ${isActive ? styles.activeParagraph : ''}`}
          >
            {item.content}
            <div className={styles.nodeIdBadge}>{item.id.substring(0, 8)}...</div>
          </div>
        );
      })}
    </div>
  );
}
