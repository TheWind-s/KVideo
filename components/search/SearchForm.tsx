'use client';

import { SearchLoadingAnimation } from '@/components/SearchLoadingAnimation';
import { SearchBox } from './SearchBox';

interface SearchFormProps {
  onSearch: (query: string) => void;
  onClear?: () => void;
  onCancelSearch?: () => void;
  isLoading: boolean;
  initialQuery?: string;
  currentSource?: string;
  checkedSources?: number;
  totalSources?: number;
  placeholder?: string;
  isPremium?: boolean;
  /** Stretch to fill a flex row (used with a sibling control) */
  inline?: boolean;
}

export function SearchForm({
  onSearch,
  onClear,
  onCancelSearch,
  isLoading,
  initialQuery = '',
  currentSource = '',
  checkedSources = 0,
  totalSources = 16,
  placeholder,
  isPremium = false,
  inline = false,
}: SearchFormProps) {
  return (
    <div className={inline ? 'flex-1 min-w-0' : 'max-w-3xl mx-auto w-full'}>
      <SearchBox
        onSearch={onSearch}
        onClear={onClear}
        initialQuery={initialQuery}
        placeholder={placeholder}
        isPremium={isPremium}
      />

      {/* Loading Animation */}
      {isLoading && (
        <div className="mt-4">
          <SearchLoadingAnimation
            currentSource={currentSource}
            checkedSources={checkedSources}
            totalSources={totalSources}
            onCancel={onCancelSearch}
          />
        </div>
      )}
    </div>
  );
}
