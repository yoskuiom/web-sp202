import React, { useRef, useState, useEffect } from 'react';

export const Knob = ({
  min,
  max,
  value,
  onChange,
  label,
  sublabel
}) => {
  const knobRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const range = max - min;
  // Map value to angle (-135deg to +135deg)
  const percent = (value - min) / range;
  const angle = -135 + percent * 270;

  const handleMouseDown = (e) => {
    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
    document.body.style.cursor = 'ns-resize';
  };

  const handleTouchStart = (e) => {
    setIsDragging(true);
    startY.current = e.touches[0].clientY;
    startVal.current = value;
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaY = startY.current - e.clientY; // drag up to increase
      const sensitivity = range / 200; // 200px drag for full range
      let newVal = startVal.current + deltaY * sensitivity;
      newVal = Math.max(min, Math.min(max, newVal));
      onChange(newVal);
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;
      const deltaY = startY.current - e.touches[0].clientY;
      const sensitivity = range / 200;
      let newVal = startVal.current + deltaY * sensitivity;
      newVal = Math.max(min, Math.min(max, newVal));
      onChange(newVal);
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = 'default';
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, value, onChange, min, max, range]);

  // Support mouse wheel
  const handleWheel = (e) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    const step = range / 40; // 40 steps total
    let newVal = value + direction * step;
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  };

  return (
    <div className="flex flex-col items-center select-none">
      <span className="text-[#ff1a1a] text-[10px] font-black italic tracking-wider mb-2 uppercase text-center drop-shadow-[0_0_1px_rgba(255,26,26,0.3)]">
        {label}
      </span>
      
      {/* Knob Container */}
      <div className="relative flex items-center justify-center p-1 bg-gradient-to-b from-[#111] to-[#222] rounded-full shadow-[inset_0_2px_5px_rgba(0,0,0,0.8),0_1px_1px_rgba(255,255,255,0.1)]">
        {/* Outer tick marks (simulated with SVG background or decorative circle) */}
        <div className="w-[72px] h-[72px] rounded-full border border-zinc-800/50 flex items-center justify-center relative">
          
          {/* Ticks representation */}
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-zinc-700/20 rotate-45"></div>
 
          {/* Actual Knob Body */}
          <div
            ref={knobRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onWheel={handleWheel}
            style={{ transform: `rotate(${angle}deg)` }}
            className={`w-[54px] h-[54px] rounded-full bg-gradient-to-br from-[#333] to-black border-4 border-black relative cursor-ns-resize shadow-inner active:scale-98 transition-transform duration-75`}
          >
            {/* Red Indicator Notch */}
            <div className="absolute top-0.5 left-1/2 w-1 h-3.5 bg-[#ff1a1a] -translate-x-1/2 rounded-full shadow-[0_0_4px_rgba(255,26,26,0.6)]"></div>
            
            {/* Center Cap Detail */}
            <div className="absolute inset-2 rounded-full bg-gradient-to-tr from-[#111] to-[#222] border border-black flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-[#ff1a1a]/60"></div>
            </div>
          </div>
        </div>
      </div>

      {sublabel && (
        <div className="text-[#ff1a1a]/80 text-[7px] font-bold mt-1.5 uppercase flex items-center gap-1">
          {sublabel}
        </div>
      )}
    </div>
  );
};
