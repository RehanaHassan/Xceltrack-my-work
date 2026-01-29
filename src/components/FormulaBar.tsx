import React, { useState, useEffect } from 'react';

interface FormulaBarProps {
    selectedCell?: string;
    cellFormula?: string;
    onFormulaChange?: (formula: string) => void;
    onFormulaSubmit?: (formula: string) => void;
}

const FormulaBar: React.FC<FormulaBarProps> = ({
    selectedCell = 'A1',
    cellFormula = '',
    onFormulaChange,
    onFormulaSubmit,
}) => {
    const [formula, setFormula] = useState(cellFormula);

    useEffect(() => {
        setFormula(cellFormula);
    }, [cellFormula]);

    const handleFormulaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newFormula = e.target.value;
        setFormula(newFormula);
        onFormulaChange?.(newFormula);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onFormulaSubmit?.(formula);
        }
        if (e.key === 'Escape') {
            setFormula(cellFormula);
        }
    };

    return (
        <div className="bg-white border-b border-gray-200 px-4 py-2">
            <div className="flex items-center space-x-3">
                {/* Cell Reference Display */}
                <div className="flex items-center">
                    <div className="px-3 py-1.5 bg-gray-100 border border-gray-300 rounded-lg font-mono text-sm font-semibold text-gray-700 min-w-[80px] text-center">
                        {selectedCell}
                    </div>
                </div>

                {/* Formula Input */}
                <div className="flex-1 flex items-center">
                    <span className="text-gray-500 mr-2 font-mono text-sm">fx</span>
                    <input
                        type="text"
                        value={formula}
                        onChange={handleFormulaChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter formula or value..."
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                </div>

                {/* Submit Button */}
                <button
                    onClick={() => onFormulaSubmit?.(formula)}
                    className="px-4 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                >
                    ✓ Apply
                </button>
            </div>
        </div>
    );
};

export default FormulaBar;
