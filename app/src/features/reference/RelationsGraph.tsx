import { useEffect, useMemo, useState } from "react"
import { Background, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, getBezierPath, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react"
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js"
import "@xyflow/react/dist/style.css"

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import type { GlossaryTerm, Relation } from "@/data/api"
import { useSpell } from "@/features/review/SpellContext"
import { cn } from "cn"
import { useRelations } from "./RelationsContext"

/** A node's colours: the kind's, the one its mark in the text has. */
const KIND_CLASS: Record<GlossaryTerm["kind"], string> = {
  person: "bg-mark-term text-mark-term-ink", place: "bg-mark-note text-mark-note-ink", org: "bg-mark-comment text-mark-comment-ink",
  work: "bg-mark-italic text-mark-italic-ink", other: "bg-muted text-foreground",
}

type TermNode = Node<{ term: GlossaryTerm; dim: boolean }, "term">
type RelationEdge = Edge<{ relation: Relation; lit: boolean; dim: boolean; onJump: () => void; onRemove: () => void }, "relation">

function TermNodeView({ data: { term, dim } }: NodeProps<TermNode>) {
  return (
    <div className={cn("rounded-md border px-2 py-1 text-xs shadow-sm transition-opacity", KIND_CLASS[term.kind], dim && "opacity-30")} data-relation-node={term.term}>
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-transparent" />
      <div className="font-medium" lang="en">{term.term}</div>
      {term.translation && <div lang="ko" className="opacity-80">{term.translation}</div>}
      <Handle type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-transparent" />
    </div>
  )
}

/** The line and its label. The label is the handle: a click goes to the paragraph the relation rests on, a right click
 *  offers to remove it (the translator's write, undone with ⌘Z). */
function RelationEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<RelationEdge>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const { relation, lit, dim, onJump, onRemove } = data!
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: lit ? "var(--primary)" : "var(--border)", strokeWidth: lit ? 2 : 1.25, opacity: dim ? 0.25 : 1 }} />
      <EdgeLabelRenderer>
        <ContextMenu>
          <ContextMenuTrigger
            render={<button type="button" />}
            data-relation={relation.id} data-lit={lit || undefined} aria-label={`${relation.from} → ${relation.to}: ${relation.label}`}
            title={`¶${relation.segmentId}${relation.quote ? ` “${relation.quote}”` : ""}`}
            className={cn("nodrag nopan pointer-events-auto absolute rounded bg-background px-1 text-[10px] whitespace-nowrap", lit ? "font-medium text-primary" : "text-muted-foreground", dim && "opacity-25")}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} lang="ko"
            onClick={onJump}
          >{relation.label}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={onJump}>Go to ¶{relation.segmentId}</ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={onRemove}>Remove relation</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { term: TermNodeView }
const edgeTypes = { relation: RelationEdgeView }
const elk = new ELK()
const LAYOUT = { "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.spacing.nodeNode": "28", "elk.layered.spacing.nodeNodeBetweenLayers": "56", "elk.edgeRouting": "SPLINES" }

interface Props { onJump: (segmentId: number, chapterId: number) => void }

/** The relations recorded so far as a graph (docs/relations.md): nodes are the glossary terms with a relation, placed by
 *  ELK; edges are the relations. The selected paragraph lights the edges resting on it and dims the rest. The column is
 *  narrow: the graph is not shrunk below 0.9 to fit, it is panned. */
export function RelationsGraph({ onJump }: Props) {
  const rel = useRelations()
  const spell = useSpell()
  const relations = useMemo(() => rel?.relations ?? [], [rel?.relations])
  const selected = rel?.selectedSegmentId ?? null
  const linked = useMemo(() => (spell?.glossary ?? []).filter((t) => relations.some((r) => r.from === t.term || r.to === t.term)), [spell?.glossary, relations])
  const [placed, setPlaced] = useState<{ key: string; at: Map<string, { x: number; y: number }> } | null>(null)
  const key = `${linked.map((t) => `${t.term}:${t.translation ? 1 : 0}`).join("|")}#${relations.map((r) => `${r.id}:${r.from}>${r.to}`).join("|")}`

  useEffect(() => {
    let live = true
    const graph: ElkNode = {
      id: "root", layoutOptions: LAYOUT,
      children: linked.map((t) => ({ id: t.term, width: Math.max(72, t.term.length * 6.5 + 18), height: t.translation ? 42 : 26 })),
      edges: relations.map((r) => ({ id: String(r.id), sources: [r.from], targets: [r.to] })),
    }
    void elk.layout(graph).then((out) => { if (live) setPlaced({ key, at: new Map((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])) }) })
    return () => { live = false }
  }, [key, linked, relations])

  const anyLit = selected !== null && relations.some((r) => r.segmentId === selected)
  const nodes: TermNode[] = useMemo(() => linked.map((t) => ({
    id: t.term, type: "term", position: placed?.at.get(t.term) ?? { x: 0, y: 0 },
    data: { term: t, dim: anyLit && !relations.some((r) => r.segmentId === selected && (r.from === t.term || r.to === t.term)) },
  })), [linked, placed, anyLit, relations, selected])
  const edges: RelationEdge[] = useMemo(() => relations.map((r) => ({
    id: String(r.id), type: "relation", source: r.from, target: r.to,
    data: { relation: r, lit: r.segmentId === selected, dim: anyLit && r.segmentId !== selected, onJump: () => onJump(r.segmentId, r.chapterId), onRemove: () => void rel?.actions.remove(r.id) },
  })), [relations, selected, anyLit, onJump, rel])

  if (!relations.length) return <p className="p-3 text-xs text-muted-foreground">No relations yet. Ask Claude to map a chapter's people, or select words in the source and add one.</p>
  if (!placed || placed.key !== key) return <p className="p-3 text-xs text-muted-foreground">Placing…</p>
  return (
    <div className="h-full text-foreground" data-relations-graph>
      <ReactFlow
        key={placed.key} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        fitView fitViewOptions={{ padding: 0.1, minZoom: 0.9, maxZoom: 1.2 }} minZoom={0.3} proOptions={{ hideAttribution: true }}
        nodesConnectable={false} elementsSelectable={false}
      >
        <Background gap={16} />
      </ReactFlow>
    </div>
  )
}
