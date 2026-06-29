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
        label: r.verb || r.name || r.type,
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
          nodeCanvasObject={(node: any, ctx: any, globalScale: number) => {
            const label = node.name;
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, node.x, node.y + 8 + (fontSize / 2)); 
            
            ctx.beginPath();
            ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color || '#3b82f6';
            ctx.fill();
          }}
          linkCanvasObjectMode={() => 'after'}
          linkCanvasObject={(link: any, ctx: any, globalScale: number) => {
            const start = link.source;
            const end = link.target;
            if (typeof start !== 'object' || typeof end !== 'object') return;

            const textPos = {
              x: start.x + (end.x - start.x) / 2,
              y: start.y + (end.y - start.y) / 2
            };

            const relLink = { x: end.x - start.x, y: end.y - start.y };
            let textAngle = Math.atan2(relLink.y, relLink.x);
            if (textAngle > Math.PI / 2) textAngle = -(Math.PI - textAngle);
            if (textAngle < -Math.PI / 2) textAngle = -(-Math.PI - textAngle);

            const label = link.label;
            if (!label) return;
            
            const fontSize = Math.max(2, 10 / globalScale);
            ctx.font = `${fontSize}px Sans-Serif`;
            
            ctx.save();
            ctx.translate(textPos.x, textPos.y);
            ctx.rotate(textAngle);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
            ctx.fillText(label, 0, -2);
            ctx.restore();
          }}
        />
      )}
    </div>
  );
}
