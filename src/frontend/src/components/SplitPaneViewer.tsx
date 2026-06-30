"use client";

import { useEffect, useState } from "react";
import styles from "./SplitPaneViewer.module.css";
import GraphPane from "./GraphPane";
import ProvenancePane from "./ProvenancePane";

interface GraphData {
  graph: any[];
  provenance: { id: string; content: string }[];
}

export default function SplitPaneViewer({ entity }: { entity: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // The selected AST node IDs from clicking a node in the graph
  const [activeNodeIds, setActiveNodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setData(null);
      setActiveNodeIds(new Set());
      
      try {
        const res = await fetch(`/api/retrieve?entity=${encodeURIComponent(entity)}&_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
           const errText = await res.text();
           throw new Error(errText || "Failed to fetch provenance data");
        }
        const json = await res.json();
        if (active) setData(json);
      } catch (err: any) {
        if (active) setError(err.message || "An error occurred");
      } finally {
        if (active) setLoading(false);
      }
    };
    
    fetchData();
    return () => { active = false; };
  }, [entity]);

  return (
    <div className={styles.splitPane}>
      <div className={styles.leftPane}>
        {loading && <div className={styles.centerMessage}>Loading Graph...</div>}
        {error && <div className={styles.centerMessage}>Error: {error}</div>}
        {data && (
          <GraphPane 
            graph={data.graph} 
            onNodeClick={(sourceNodeIds) => setActiveNodeIds(new Set(sourceNodeIds))} 
          />
        )}
      </div>
      <div className={styles.divider}></div>
      <div className={styles.rightPane}>
        {loading && <div className={styles.centerMessage}>Loading Provenance...</div>}
        {error && <div className={styles.centerMessage}>Error: {error}</div>}
        {data && (
          <ProvenancePane 
            provenance={data.provenance} 
            activeNodeIds={activeNodeIds} 
            hasContradictions={data.graph.some((record: any) => record.r.type === 'CONTRADICTS' || record.r.belief_state)}
          />
        )}
      </div>
    </div>
  );
}
