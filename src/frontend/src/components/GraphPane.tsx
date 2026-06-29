"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import styles from "./SplitPaneViewer.module.css";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

export default function GraphPane({ graph, onNodeClick }: { graph: any[], onNodeClick: (ids: string[]) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const nodesMap = new Map<string, any>();
    const links: any[] = [];

    graph.forEach(record => {
      const { e, r, neighbor } = record;
      
      const sourceId = e.name;
      const targetId = neighbor.name;

      if (!nodesMap.has(sourceId)) {
        nodesMap.set(sourceId, { id: sourceId, name: e.name, type: e.type, sourceNodeIds: e.sourceNodeIds || [] });
      }
      if (!nodesMap.has(targetId)) {
        nodesMap.set(targetId, { id: targetId, name: neighbor.name, type: neighbor.type, sourceNodeIds: neighbor.sourceNodeIds || [] });
      }

      links.push({
        source: sourceId,
        target: targetId,
        label: r.name || r.type,
        sourceNodeIds: r.sourceNodeIds || []
      });
    });

    return {
      nodes: Array.from(nodesMap.values()),
      links
    };
  }, [graph]);

  return (
    <div className={styles.graphContainer} ref={containerRef}>
      {dimensions.width > 0 && (
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeLabel="name"
          nodeAutoColorBy="type"
          onNodeClick={(node: any) => onNodeClick(node.sourceNodeIds || [])}
          onLinkClick={(link: any) => onNodeClick(link.sourceNodeIds || [])}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkColor={() => 'rgba(148, 163, 184, 0.4)'}
          backgroundColor="var(--surface-bg)"
        />
      )}
    </div>
  );
}
