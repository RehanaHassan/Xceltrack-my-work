import React, { useState } from 'react';
import {
  FiBold,
  FiItalic,
  FiUnderline,
  FiAlignLeft,
  FiAlignCenter,
  FiAlignRight,
  FiSave,
  FiDownload,
  FiUpload,
} from 'react-icons/fi';
import { MdFormatColorText, MdFormatColorFill } from 'react-icons/md';
import Tooltip from './Tooltip';

interface EditorToolbarProps {
  onSave?: (data?: any) => void;
  onDownload?: () => void;
  onUpload?: () => void;
  onFormatChange?: (format: any) => void;
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  onSave,
  onDownload,
  onUpload,
  onFormatChange,
}) => {
  const [fontSize, setFontSize] = useState('11');
  const [fontFamily, setFontFamily] = useState('Arial');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);

  const fontSizes = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32'];
  const fontFamilies = ['Arial', 'Calibri', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia'];

  const handleFontSizeChange = (size: string) => {
    setFontSize(size);
    onFormatChange?.({ fontSize: size });
  };

  const handleFontFamilyChange = (family: string) => {
    setFontFamily(family);
    onFormatChange?.({ fontFamily: family });
  };

  const toggleBold = () => {
    setIsBold(!isBold);
    onFormatChange?.({ bold: !isBold });
  };

  const toggleItalic = () => {
    setIsItalic(!isItalic);
    onFormatChange?.({ italic: !isItalic });
  };

  const toggleUnderline = () => {
    setIsUnderline(!isUnderline);
    onFormatChange?.({ underline: !isUnderline });
  };

  const handleAlignment = (align: 'left' | 'center' | 'right') => {
    onFormatChange?.({ alignment: align });
  };

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left Section - File Actions */}
        <div className="flex items-center space-x-1 sm:space-x-2">
          <Tooltip content="Save Changes (Ctrl+S)">
            <button
              onClick={onSave}
              className="flex items-center space-x-1 px-2 sm:px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              {(FiSave as any)({ size: 16 })}
              <span className="hidden sm:inline text-sm font-medium">Save</span>
            </button>
          </Tooltip>
          <Tooltip content="Upload New File">
            <button
              onClick={onUpload}
              className="flex items-center space-x-1 px-2 sm:px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {(FiUpload as any)({ size: 16 })}
              <span className="hidden sm:inline text-sm font-medium">Upload</span>
            </button>
          </Tooltip>
          <Tooltip content="Download XLSX">
            <button
              onClick={onDownload}
              className="flex items-center space-x-1 px-2 sm:px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {(FiDownload as any)({ size: 16 })}
              <span className="hidden sm:inline text-sm font-medium">Download</span>
            </button>
          </Tooltip>
        </div>

        {/* Middle Section - Formatting */}
        <div className="flex items-center space-x-4">
          {/* Font Family */}
          <select
            value={fontFamily}
            onChange={(e) => handleFontFamilyChange(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {fontFamilies.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>

          {/* Font Size */}
          <select
            value={fontSize}
            onChange={(e) => handleFontSizeChange(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {fontSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300"></div>

          {/* Text Formatting */}
          <div className="flex items-center space-x-1">
            <Tooltip content="Bold (Ctrl+B)">
              <button
                onClick={toggleBold}
                className={`p-2 rounded-lg transition-colors ${isBold
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                {(FiBold as any)({ size: 18 })}
              </button>
            </Tooltip>
            <Tooltip content="Italic (Ctrl+I)">
              <button
                onClick={toggleItalic}
                className={`p-2 rounded-lg transition-colors ${isItalic
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                {(FiItalic as any)({ size: 18 })}
              </button>
            </Tooltip>
            <Tooltip content="Underline (Ctrl+U)">
              <button
                onClick={toggleUnderline}
                className={`p-2 rounded-lg transition-colors ${isUnderline
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                {(FiUnderline as any)({ size: 18 })}
              </button>
            </Tooltip>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300"></div>

          {/* Alignment */}
          <div className="flex items-center space-x-1">
            <Tooltip content="Align Left">
              <button
                onClick={() => handleAlignment('left')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {(FiAlignLeft as any)({ size: 18 })}
              </button>
            </Tooltip>
            <Tooltip content="Align Center">
              <button
                onClick={() => handleAlignment('center')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {(FiAlignCenter as any)({ size: 18 })}
              </button>
            </Tooltip>
            <Tooltip content="Align Right">
              <button
                onClick={() => handleAlignment('right')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                {(FiAlignRight as any)({ size: 18 })}
              </button>
            </Tooltip>
          </div>

          {/* Divider */}
          <div className="h-6 w-px bg-gray-300"></div>

          {/* Colors */}
          <div className="flex items-center space-x-1">
            <button
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Text Color"
            >
              {(MdFormatColorText as any)({ size: 20 })}
            </button>
            <button
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Fill Color"
            >
              {(MdFormatColorFill as any)({ size: 20 })}
            </button>
          </div>
        </div>

        {/* Right Section - Placeholder */}
        <div className="w-32"></div>
      </div>
    </div>
  );
};

export default EditorToolbar;