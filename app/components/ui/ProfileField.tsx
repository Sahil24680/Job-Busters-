// app/components/ui/ProfileField.tsx

import React from 'react';


type ProfileFields = {
  label: string;
  value: string | null | undefined;
  isEditing: boolean;
  // Handler for when the input changes 
  onChange?: (newValue: string) => void; 
  hint?: string;
};

export function ProfileField({ 
  label, 
  value, 
  isEditing, 
  onChange, 
  hint 
}: ProfileFields) {
  
  const displayValue = value ?? "Not set";

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      
      {isEditing ? (
        <input
          type="text"
          value={displayValue}
          onChange={(e) => onChange?.(e.target.value)}

          // editable input
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
          disabled={!onChange} 
        />
      ) : (
        <p 
          // read-only paragraph
          className="px-4 py-2 bg-gray-50 rounded-lg text-gray-900"
        >
          {displayValue}
        </p>
      )}

      {hint && (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
    </div>
  );
}