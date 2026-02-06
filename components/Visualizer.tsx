
import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../services/audioEngine';

interface VisualizerProps {
  theme?: 'dark' | 'light';
}

export const Visualizer: React.FC<VisualizerProps> = ({ theme = 'dark' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const analyzer = audioEngine.getAnalyzer();
      if (!analyzer) {
        requestAnimationFrame(render);
        return;
      }

      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyzer.getByteFrequencyData(dataArray);

      // Theme-aware colors
      const bgColor = theme === 'dark' ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)';
      const barColor = theme === 'dark' ? 'rgb(51, 65, 85)' : 'rgb(203, 213, 225)';
      const activeBarColor = theme === 'dark' ? 'rgb(99, 102, 241)' : 'rgb(79, 70, 229)';

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / 200); 
      let x = 0;

      for (let i = 0; i < 200; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = i > 50 && i < 110 ? activeBarColor : barColor;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }

      requestAnimationFrame(render);
    };

    render();
  }, [theme]);

  return (
    <div className={`w-full h-24 rounded-xl overflow-hidden border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'} shadow-inner`}>
      <canvas ref={canvasRef} width={600} height={100} className="w-full h-full" />
    </div>
  );
};
