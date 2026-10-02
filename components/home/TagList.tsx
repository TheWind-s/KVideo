'use client';

import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTag, Tag } from './SortableTag';
import { useState, useRef, useEffect } from 'react';
import { Icons } from '@/components/ui/Icon';

interface RecommendTagConfig {
    label: string;
    isSelected: boolean;
    onSelect: () => void;
}

interface TagListProps {
    tags: Tag[];
    selectedTag: string;
    showTagManager: boolean;
    justAddedTag: boolean;
    onTagSelect: (tagId: string) => void;
    onTagDelete: (tagId: string) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onJustAddedTagHandled: () => void;
    recommendTag?: RecommendTagConfig;
    onToggleManager: () => void;
    onRestoreDefaults: () => void;
}

export function TagList({
    tags,
    selectedTag,
    showTagManager,
    justAddedTag,
    onTagSelect,
    onTagDelete,
    onDragEnd,
    onJustAddedTagHandled,
    recommendTag,
    onToggleManager,
    onRestoreDefaults,
}: TagListProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Auto-scroll to end when new tag is added
    useEffect(() => {
        if (justAddedTag && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                left: scrollContainerRef.current.scrollWidth,
                behavior: 'smooth',
            });
            onJustAddedTagHandled();
        }
    }, [justAddedTag, onJustAddedTagHandled]);

    // Handle horizontal scroll with mouse wheel
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            // Check if it's a vertical scroll (mostly deltaY) and negligible horizontal scroll
            if (e.deltaY !== 0 && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
                e.preventDefault();
                container.scrollLeft += e.deltaY;
            }
        };

        // Add passive: false to allow preventDefault
        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, []);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        onDragEnd(event);
    };

    const activeTag = tags.find((t) => t.id === activeId);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div
                ref={scrollContainerRef}
                className={`mb-6 flex items-center gap-2 pb-2 pt-1 px-1 scrollbar-hide ${
                    showTagManager
                        ? 'flex-wrap overflow-visible'
                        : 'overflow-x-auto'
                }`}
            >
                {/* Recommendation Tag — non-draggable, rendered before sortable tags */}
                {recommendTag && (
                    <div className="relative flex-shrink-0">
                        <button
                            type="button"
                            onClick={recommendTag.onSelect}
                            className={`
                                px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-[13px] font-semibold transition-all whitespace-nowrap rounded-[var(--radius-full)] cursor-pointer select-none flex items-center gap-1
                                ${recommendTag.isSelected
                                    ? 'bg-[var(--accent-color)] text-white shadow-md scale-105'
                                    : 'bg-[var(--glass-bg)] backdrop-blur-xl text-[var(--text-color)] border border-[var(--glass-border)] hover:border-[var(--accent-color)] hover:scale-105'
                                }
                            `}
                        >
                            <Icons.Sparkles size={12} />
                            {recommendTag.label}
                        </button>
                    </div>
                )}
                <SortableContext
                    items={tags.map((t) => t.id)}
                    strategy={showTagManager ? rectSortingStrategy : horizontalListSortingStrategy}
                >
                    {tags.map((tag) => (
                        <SortableTag
                            key={tag.id}
                            tag={tag}
                            selectedTag={selectedTag}
                            showTagManager={showTagManager}
                            onTagSelect={onTagSelect}
                            onTagDelete={onTagDelete}
                        />
                    ))}
                </SortableContext>

                {/* Divider + inline tag management actions */}
                <div className="w-px h-4 bg-[var(--glass-border)] flex-shrink-0 mx-1" />
                {showTagManager ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            type="button"
                            onClick={onRestoreDefaults}
                            className="px-3 py-1.5 text-xs font-medium whitespace-nowrap rounded-[var(--radius-full)] text-[var(--text-color-secondary)] border border-[var(--glass-border)] hover:text-[var(--accent-color)] hover:border-[var(--accent-color)] transition-colors cursor-pointer flex items-center gap-1"
                        >
                            <Icons.RefreshCw size={12} />
                            恢复默认
                        </button>
                        <button
                            type="button"
                            onClick={onToggleManager}
                            className="px-3 py-1.5 text-xs font-semibold whitespace-nowrap rounded-[var(--radius-full)] bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                        >
                            完成
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={onToggleManager}
                        className="px-3 py-1.5 text-xs font-medium whitespace-nowrap rounded-[var(--radius-full)] text-[var(--text-color-secondary)] border border-[var(--glass-border)] hover:text-[var(--accent-color)] hover:border-[var(--accent-color)] transition-colors cursor-pointer flex items-center gap-1 flex-shrink-0"
                    >
                        <Icons.Tag size={12} />
                        管理
                    </button>
                )}
            </div>

            <DragOverlay>
                {activeId && activeTag ? (
                    <div className="relative flex-shrink-0 animate-jiggle">
                        <button className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-[13px] font-semibold whitespace-nowrap rounded-[var(--radius-full)] bg-[var(--accent-color)] text-white shadow-xl scale-110 cursor-grabbing border border-transparent">
                            {activeTag.label}
                        </button>
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
