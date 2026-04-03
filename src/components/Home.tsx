import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Plus } from "lucide-react";
import { motion } from "motion/react";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 10);
    navigate(`/room/${newRoomId}`);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    let id = roomId.trim();
    if (id.includes('/room/')) {
      id = id.split('/room/')[1];
    }
    id = id.split('?')[0].replace(/\/$/, '');
    
    if (id) {
      navigate(`/room/${id}`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="space-y-2">
          <h1 className="text-6xl font-black tracking-tighter text-white">
            sk<span className="text-red-600">live</span>
          </h1>
          <p className="text-gray-400 text-lg">hopefully this works for movie night</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={createRoom}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-6 rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-600/20"
          >
            <Plus size={24} />
            Create New Room
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-800"></span>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#0a0a0a] px-2 text-gray-500">Or join existing</span>
            </div>
          </div>

          <form onSubmit={joinRoom} className="flex gap-2">
            <input
              type="text"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-600 transition-all"
            />
            <button
              type="submit"
              className="bg-gray-800 hover:bg-gray-700 text-white p-3 rounded-xl transition-all"
            >
              <Play size={24} />
            </button>
          </form>
        </div>

        <div className="pt-8 text-gray-600 text-sm">
          As smoothly as possible with out gutter network(s)
        </div>
      </motion.div>
    </div>
  );
}
