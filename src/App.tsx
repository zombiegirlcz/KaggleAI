import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  addDoc, 
  setDoc, 
  doc, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { 
  Play, 
  Square, 
  Plus, 
  Settings, 
  LogOut, 
  Cpu, 
  Database, 
  Activity, 
  HardDrive,
  Globe,
  MessageSquare, 
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Save,
  ChevronRight,
  Terminal,
  Search,
  Check,
  X,
  Loader2,
  Clock,
  Info,
  FileText,
  Link,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateAutomationScript } from './services/gemini';

// --- UI Helpers ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  kaggleUsername?: string;
  kaggleApiKey?: string;
  colabToken?: string;
}

interface Notebook {
  id: string;
  userId: string;
  name: string;
  platform: 'kaggle' | 'colab';
  status: 'idle' | 'running' | 'error' | 'completed';
  lastLoss?: number;
  progress?: number;
  autoSaveEnabled: boolean;
  lastAutoSave?: Timestamp;
  config?: any;
  datasetIds?: string[];
  modelIds?: string[];
  collectionIds?: string[];
  gpuEnabled: boolean;
  gpuType?: 'T4' | 'P100' | 'V100' | 'TPU';
  gpuCount?: number;
  internetEnabled: boolean;
  venv?: {
    type: 'venv' | 'conda' | 'none';
    name: string;
  };
}

interface Dataset {
  id: string;
  userId: string;
  name: string;
  description?: string;
  fileUrl?: string;
  size?: number;
  createdAt: Timestamp;
  format: string;
  isPublic: boolean;
  tags?: string[];
}

interface Collection {
  id: string;
  userId: string;
  name: string;
  datasetIds: string[];
  createdAt: Timestamp;
}

interface Model {
  id: string;
  userId: string;
  name: string;
  description?: string;
  framework: 'pytorch' | 'tensorflow' | 'jax' | 'other';
  isPublic: boolean;
  fileUrl?: string;
  size?: number;
  createdAt: Timestamp;
  tags?: string[];
}

interface TrainingLog {
  id: string;
  notebookId: string;
  timestamp: Timestamp;
  loss?: number;
  accuracy?: number;
  epoch?: number;
  message: string;
  metrics?: {
    cpu?: number;
    ram?: number;
    gpu?: number;
    vram?: number;
  };
}

// --- Components ---

const Card = ({ children, className, onClick, ...props }: { children: React.ReactNode; className?: string; onClick?: () => void; [key: string]: any }) => (
  <div 
    onClick={onClick}
    className={cn("bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4", className)}
    {...props}
  >
    {children}
  </div>
);

const Badge = ({ children, variant = 'default', className }: { children: React.ReactNode; variant?: 'default' | 'success' | 'warning' | 'error'; className?: string }) => {
  const variants = {
    default: "bg-zinc-800 text-zinc-300",
    success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    error: "bg-red-500/10 text-red-400 border border-red-500/20",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider", variants[variant], className)}>
      {children}
    </span>
  );
};

const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="group relative flex items-center">
    {children}
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-zinc-700">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
    </div>
  </div>
);

const ResourceMonitor = ({ metrics }: { metrics?: TrainingLog['metrics'] }) => {
  if (!metrics) return null;
  
  const items = [
    { label: 'CPU', value: Math.round(metrics.cpu), color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: 'RAM', value: Math.round(metrics.ram), color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: 'GPU', value: Math.round(metrics.gpu), color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { label: 'VRAM', value: Math.round(metrics.vram), color: 'text-orange-400', bg: 'bg-orange-400/10' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((item) => (
        <div key={item.label} className={cn("p-2 rounded-xl border border-zinc-800", item.bg)}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[8px] font-bold uppercase text-zinc-500">{item.label}</span>
            <span className={cn("text-[10px] font-bold", item.color)}>{item.value || 0}%</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-500", item.color.replace('text-', 'bg-'))} 
              style={{ width: `${item.value || 0}%` }} 
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<'notebooks' | 'models' | 'datasets'>('notebooks');
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [publicDatasets, setPublicDatasets] = useState<Dataset[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [publicModels, setPublicModels] = useState<Model[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [isAddingDataset, setIsAddingDataset] = useState(false);
  const [isAddingCollection, setIsAddingCollection] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const seedSampleData = async () => {
    if (!user) return;
    setIsSeeding(true);
    try {
      // Add a sample dataset
      const dsRef = await addDoc(collection(db, 'datasets'), {
        userId: user.uid,
        name: 'MNIST-Digits-Sample',
        description: 'Sample dataset for digit recognition',
        format: 'images',
        isPublic: false,
        createdAt: serverTimestamp(),
        tags: ['sample', 'vision']
      });

      // Add a sample model
      await addDoc(collection(db, 'models'), {
        userId: user.uid,
        name: 'Simple-CNN-Base',
        framework: 'pytorch',
        isPublic: false,
        createdAt: serverTimestamp(),
        version: 1,
        size: 1024 * 1024 * 2,
        tags: ['sample', 'cnn']
      });

      // Add a sample collection
      await addDoc(collection(db, 'collections'), {
        userId: user.uid,
        name: 'Starter-Pack',
        datasetIds: [dsRef.id],
        createdAt: serverTimestamp()
      });

      // Add a public dataset if none exist
      if (publicDatasets.length === 0) {
        await addDoc(collection(db, 'datasets'), {
          userId: 'system',
          name: 'ImageNet-Mini-Public',
          description: 'Public subset of ImageNet',
          format: 'images',
          isPublic: true,
          createdAt: serverTimestamp(),
          tags: ['public', 'vision']
        });
      }

      // Add a public model if none exist
      if (publicModels.length === 0) {
        await addDoc(collection(db, 'models'), {
          userId: 'system',
          name: 'ResNet50-Pretrained',
          framework: 'pytorch',
          isPublic: true,
          createdAt: serverTimestamp(),
          version: 1,
          size: 1024 * 1024 * 98,
          tags: ['public', 'pretrained']
        });
      }

    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'seed-data');
    } finally {
      setIsSeeding(false);
    }
  };
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [linkingModel, setLinkingModel] = useState<Model | null>(null);
  const [linkingDataset, setLinkingDataset] = useState<Dataset | null>(null);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [kaggleInputMode, setKaggleInputMode] = useState<'manual' | 'json'>('manual');
  const [isVerifyingKaggle, setIsVerifyingKaggle] = useState(false);
  const [kaggleVerifyStatus, setKaggleVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [kaggleJson, setKaggleJson] = useState('');
  const [prompt, setPrompt] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [kaggleDatasets, setKaggleDatasets] = useState<any[]>([]);
  const [isSearchingKaggle, setIsSearchingKaggle] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [appError, setAppError] = useState<Error | null>(null);

  // --- Auth ---
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Data Subscription ---
  useEffect(() => {
    if (!user) return;

    const qNotebooks = query(collection(db, 'notebooks'), where('userId', '==', user.uid));
    const unsubNotebooks = onSnapshot(qNotebooks, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notebook));
      setNotebooks(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'notebooks'));

    const qModels = query(collection(db, 'models'), where('userId', '==', user.uid));
    const unsubModels = onSnapshot(qModels, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Model));
      setModels(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'models'));

    const qDatasets = query(collection(db, 'datasets'), where('userId', '==', user.uid));
    const unsubDatasets = onSnapshot(qDatasets, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Dataset));
      setDatasets(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'datasets'));

    const qPublicDatasets = query(collection(db, 'datasets'), where('isPublic', '==', true));
    const unsubPublicDatasets = onSnapshot(qPublicDatasets, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Dataset));
      setPublicDatasets(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'datasets'));

    const qCollections = query(collection(db, 'collections'), where('userId', '==', user.uid));
    const unsubCollections = onSnapshot(qCollections, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Collection));
      setCollections(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'collections'));

    const qPublicModels = query(collection(db, 'models'), where('isPublic', '==', true));
    const unsubPublicModels = onSnapshot(qPublicModels, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Model));
      setPublicModels(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'models'));

    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile({ uid: snapshot.id, ...snapshot.data() } as UserProfile);
      } else {
        // Create initial profile if it doesn't exist
        setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          createdAt: serverTimestamp()
        });
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

    return () => {
      unsubNotebooks();
      unsubModels();
      unsubDatasets();
      unsubPublicDatasets();
      unsubCollections();
      unsubPublicModels();
      unsubProfile();
    };
  }, [user]);

  const allDatasets = Array.from(new Map([...datasets, ...publicDatasets].map(item => [item.id, item])).values());
  const allModels = Array.from(new Map([...models, ...publicModels].map(item => [item.id, item])).values());

  // --- Simulated Training Progress ---
  useEffect(() => {
    const runningNotebooks = notebooks.filter(n => n.status === 'running');
    if (runningNotebooks.length === 0) return;

    const interval = setInterval(async () => {
      for (const nb of runningNotebooks) {
        const currentProgress = nb.progress || 0;
        const progress = Math.min(currentProgress + Math.random() * 3, 100);
        const isCompleted = progress >= 100;
        
        // Find assigned models to get the correct name for logs
        const assignedModels = allModels.filter(m => nb.modelIds?.includes(m.id));
        const modelName = assignedModels.length > 0 ? assignedModels[0].name : 'model.pth';
        
        // Update notebook progress
        await setDoc(doc(db, 'notebooks', nb.id), {
          progress,
          status: isCompleted ? 'completed' : 'running',
          lastLoss: Math.random() * 0.5
        }, { merge: true });

        // Add a log entry
        let message = `[Epoch ${Math.floor(progress / 10)}] Loss: ${(Math.random() * 0.5).toFixed(4)} - Accuracy: ${(0.7 + Math.random() * 0.2).toFixed(4)}`;
        
        if (currentProgress === 0) {
          message = `Preparing environment... /kaggle/input/datasets loaded. Loading ${modelName} weights...`;
        } else if (currentProgress < 10) {
          message = `Model ${modelName} loaded from /kaggle/input. Starting training loop...`;
        } else if (isCompleted) {
          message = `Training successful. Saving model to /kaggle/working/output/${modelName}. Updating input model reference...`;
          
          // Simulate updating the model in "input" by creating/updating a model entry
          if (assignedModels.length > 0) {
            const modelToUpdate = assignedModels[0];
            await setDoc(doc(db, 'models', modelToUpdate.id), {
              ...modelToUpdate,
              size: (modelToUpdate.size || 0) + 1024 * 1024 * 5, // Simulate size increase
              lastUpdated: serverTimestamp(),
              version: (modelToUpdate.version || 1) + 1,
              tags: Array.from(new Set([...(modelToUpdate.tags || []), 'trained', 'v' + ((modelToUpdate.version || 1) + 1)]))
            }, { merge: true });
          }
        } else if (Math.random() > 0.6) {
          const logMessages = [
            `Checkpoint for ${modelName} saved to /kaggle/working/checkpoints/`,
            "Validating on test set...",
            "Learning rate adjusted to " + (0.001 * (1 - progress/100)).toFixed(6),
            "Data augmentation applied to batch...",
            "Syncing logs to dashboard...",
            `Optimizing ${modelName} parameters...`,
            "Calculating gradients..."
          ];
          message = logMessages[Math.floor(Math.random() * logMessages.length)];
        }

        await addDoc(collection(db, `notebooks/${nb.id}/logs`), {
          notebookId: nb.id,
          timestamp: serverTimestamp(),
          message,
          loss: Math.random() * 0.5,
          accuracy: 0.7 + Math.random() * 0.2,
          epoch: Math.floor(progress / 10),
          metrics: {
            cpu: Math.round(40 + Math.random() * 30),
            ram: Math.round(50 + Math.random() * 20),
            gpu: nb.gpuEnabled ? Math.round(60 + Math.random() * 30) : 0,
            vram: nb.gpuEnabled ? Math.round(40 + Math.random() * 40) : 0
          }
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [notebooks]);

  useEffect(() => {
    if (!selectedNotebook) {
      setLogs([]);
      return;
    }

    const q = query(
      collection(db, `notebooks/${selectedNotebook.id}/logs`),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrainingLog));
      setLogs(data);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `notebooks/${selectedNotebook.id}/logs`));

    return unsubscribe;
  }, [selectedNotebook]);

  useEffect(() => {
    if (selectedNotebook) {
      const updated = notebooks.find(n => n.id === selectedNotebook.id);
      if (updated) setSelectedNotebook(updated);
    }
  }, [notebooks]);

  // --- Actions ---
  const addNotebook = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const platform = formData.get('platform') as 'kaggle' | 'colab';

    try {
      await addDoc(collection(db, 'notebooks'), {
        userId: user.uid,
        name,
        platform,
        status: 'idle',
        autoSaveEnabled: true,
        progress: 0,
        gpuEnabled: formData.get('gpuEnabled') === 'on',
        gpuType: formData.get('gpuType') || 'T4',
        gpuCount: parseInt(formData.get('gpuCount') as string) || 1,
        internetEnabled: formData.get('internetEnabled') === 'on',
        createdAt: serverTimestamp(),
        venv: {
          type: formData.get('venvType') || 'none',
          name: formData.get('venvName') || ''
        }
      });
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notebooks');
    }
  };

  const addModel = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const framework = formData.get('framework') as any;
    const isPublic = formData.get('isPublic') === 'on';

    try {
      await addDoc(collection(db, 'models'), {
        userId: user.uid,
        name,
        framework,
        isPublic,
        createdAt: serverTimestamp(),
        tags: []
      });
      setIsAddingModel(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'models');
    }
  };

  const addDataset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    try {
      await addDoc(collection(db, 'datasets'), {
        userId: user.uid,
        name: formData.get('name'),
        description: formData.get('description') || '',
        format: formData.get('format'),
        isPublic: formData.get('isPublic') === 'on',
        createdAt: serverTimestamp(),
        tags: []
      });
      setIsAddingDataset(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'datasets');
    }
  };

  const addCollection = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const datasetIds = Array.from(formData.getAll('datasetIds')) as string[];
    
    try {
      await addDoc(collection(db, 'collections'), {
        userId: user.uid,
        name: formData.get('name'),
        datasetIds,
        createdAt: serverTimestamp()
      });
      setIsAddingCollection(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'collections');
    }
  };

  const toggleDatasetAssignment = async (notebookId: string, datasetId: string) => {
    if (!user) return;
    const nb = notebooks.find(n => n.id === notebookId);
    if (!nb) return;
    
    const currentDatasets = nb.datasetIds || [];
    const newDatasets = currentDatasets.includes(datasetId)
      ? currentDatasets.filter(id => id !== datasetId)
      : [...currentDatasets, datasetId];
      
    try {
      await setDoc(doc(db, 'notebooks', notebookId), {
        datasetIds: newDatasets
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notebooks/${notebookId}`);
    }
  };

  const toggleCollectionAssignment = async (notebookId: string, collectionId: string) => {
    if (!user) return;
    const nb = notebooks.find(n => n.id === notebookId);
    const coll = collections.find(c => c.id === collectionId);
    if (!nb || !coll) return;
    
    const currentCollections = nb.collectionIds || [];
    const isAssigned = currentCollections.includes(collectionId);
    
    let newCollections;
    let newDatasets = [...(nb.datasetIds || [])];
    
    if (isAssigned) {
      newCollections = currentCollections.filter(id => id !== collectionId);
    } else {
      newCollections = [...currentCollections, collectionId];
      coll.datasetIds.forEach(dsId => {
        if (!newDatasets.includes(dsId)) {
          newDatasets.push(dsId);
        }
      });
    }
      
    try {
      await setDoc(doc(db, 'notebooks', notebookId), {
        collectionIds: newCollections,
        datasetIds: newDatasets
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notebooks/${notebookId}`);
    }
  };

  const toggleModelAssignment = async (notebookId: string, modelId: string) => {
    if (!user) return;
    const nb = notebooks.find(n => n.id === notebookId);
    if (!nb) return;
    
    const currentModels = nb.modelIds || [];
    const newModels = currentModels.includes(modelId)
      ? currentModels.filter(id => id !== modelId)
      : [...currentModels, modelId];
      
    try {
      await setDoc(doc(db, 'notebooks', notebookId), {
        modelIds: newModels
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notebooks/${notebookId}`);
    }
  };

  const toggleDatasetInCollection = async (collectionId: string, datasetId: string) => {
    if (!user) return;
    const coll = collections.find(c => c.id === collectionId);
    if (!coll) return;
    
    const currentDatasets = coll.datasetIds || [];
    const newDatasets = currentDatasets.includes(datasetId)
      ? currentDatasets.filter(id => id !== datasetId)
      : [...currentDatasets, datasetId];
      
    try {
      await setDoc(doc(db, 'collections', collectionId), {
        datasetIds: newDatasets
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `collections/${collectionId}`);
    }
  };

  const saveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    
    let kaggleUsername = formData.get('kaggleUsername') as string;
    let kaggleApiKey = formData.get('kaggleApiKey') as string;

    if (kaggleInputMode === 'json' && kaggleJson) {
      try {
        const parsed = JSON.parse(kaggleJson);
        kaggleUsername = parsed.username;
        kaggleApiKey = parsed.key;
      } catch (e) {
        // Fallback to manual if JSON is invalid
      }
    }

    const colabToken = formData.get('colabToken') as string;

    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        kaggleUsername,
        kaggleApiKey,
        colabToken,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setIsSettingsOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const verifyKaggle = async (username: string, apiKey: string) => {
    if (!user) return;
    setIsVerifyingKaggle(true);
    setKaggleVerifyStatus('idle');
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/kaggle/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ username, apiKey })
      });
      const data = await response.json();
      if (data.success) {
        setKaggleVerifyStatus('success');
      } else {
        setKaggleVerifyStatus('error');
      }
    } catch (error) {
      setKaggleVerifyStatus('error');
    } finally {
      setIsVerifyingKaggle(false);
    }
  };

  const handleKaggleJsonChange = (val: string) => {
    setKaggleJson(val);
    try {
      const parsed = JSON.parse(val);
      if (parsed.username && parsed.key) {
        verifyKaggle(parsed.username, parsed.key);
      }
    } catch (e) {
      // Not valid JSON yet
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    
    // Simulate upload
    console.log("Uploading file:", file.name);
    addDoc(collection(db, 'models'), {
      userId: user.uid,
      name: file.name,
      framework: 'other',
      isPublic: false,
      size: file.size,
      createdAt: serverTimestamp(),
      tags: ['uploaded']
    });
  };

  const searchKaggle = async () => {
    if (!user || !modelSearch) return;
    setIsSearchingKaggle(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/kaggle/datasets?search=${encodeURIComponent(modelSearch)}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch Kaggle datasets');
      }
      const data = await response.json();
      setKaggleDatasets(data);
    } catch (error) {
      console.error("Kaggle search error:", error);
    } finally {
      setIsSearchingKaggle(false);
    }
  };

  const startAutomation = async () => {
    if (!selectedNotebook || !prompt) return;
    setIsGenerating(true);
    try {
      const assignedDatasets = datasets.filter(d => selectedNotebook.datasetIds?.includes(d.id));
      const assignedModels = models.filter(m => selectedNotebook.modelIds?.includes(m.id));
      const assignedCollections = collections.filter(c => selectedNotebook.collectionIds?.includes(c.id));
      
      const collectionDatasetIds = assignedCollections.flatMap(c => c.datasetIds);
      const collectionDatasets = allDatasets.filter(d => collectionDatasetIds.includes(d.id));
      
      const combinedDatasets = [...assignedDatasets, ...collectionDatasets];

      const script = await generateAutomationScript(
        prompt, 
        selectedNotebook.platform,
        {
          datasets: combinedDatasets,
          models: assignedModels,
          gpuEnabled: !!selectedNotebook.gpuEnabled,
          gpuType: selectedNotebook.gpuType,
          gpuCount: selectedNotebook.gpuCount,
          internetEnabled: !!selectedNotebook.internetEnabled,
          venv: selectedNotebook.venv
        }
      );

      // Check if the script actually contains training logic or if AI just gave an explanation
      const hasTrainingLogic = script.toLowerCase().includes('train') || 
                               script.toLowerCase().includes('fit(') || 
                               script.toLowerCase().includes('optimizer') ||
                               script.toLowerCase().includes('import');

      if (!hasTrainingLogic) {
        await addDoc(collection(db, `notebooks/${selectedNotebook.id}/logs`), {
          notebookId: selectedNotebook.id,
          timestamp: serverTimestamp(),
          message: "AI Automatizace: Požadavek nebyl vyhodnocen jako trénovací skript.",
          aiResponse: script,
          epoch: 0
        });
        return;
      }

      await setDoc(doc(db, 'notebooks', selectedNotebook.id), {
        ...selectedNotebook,
        status: 'running',
        config: { script, prompt }
      });
      
      await addDoc(collection(db, `notebooks/${selectedNotebook.id}/logs`), {
        notebookId: selectedNotebook.id,
        timestamp: serverTimestamp(),
        message: "AI Automatizace spuštěna. Skript vygenerován a nasazen.",
        aiResponse: script,
        epoch: 0
      });
      
      setPrompt('');
      setIsConsoleOpen(true);
    } catch (error) {
      console.error("Automation failed", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const stopAutomation = async (notebookId: string) => {
    try {
      await setDoc(doc(db, 'notebooks', notebookId), {
        status: 'idle',
        progress: 0
      }, { merge: true });

      await addDoc(collection(db, `notebooks/${notebookId}/logs`), {
        notebookId,
        timestamp: serverTimestamp(),
        message: "Proces ručně zastaven uživatelem.",
        epoch: 0
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notebooks/${notebookId}`);
    }
  };

  const updateNotebookScript = async (notebookId: string, newScript: string) => {
    try {
      await setDoc(doc(db, 'notebooks', notebookId), {
        config: { ...selectedNotebook?.config, script: newScript }
      }, { merge: true });
      
      await addDoc(collection(db, `notebooks/${notebookId}/logs`), {
        notebookId,
        timestamp: serverTimestamp(),
        message: "Skript byl ručně upraven uživatelem v konzoli.",
        epoch: 0
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notebooks/${notebookId}`);
    }
  };

  if (appError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 text-center">
        <div className="max-w-md space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold text-white">Něco se pokazilo</h1>
          <p className="text-zinc-400 text-sm">
            {appError.message || "Došlo k neočekávané chybě."}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Znovu načíst
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-6 max-w-sm"
        >
          <div className="w-20 h-20 bg-emerald-500/20 rounded-3xl flex items-center justify-center mx-auto border border-emerald-500/30">
            <Cpu className="w-10 h-10 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">KaggleAI</h1>
            <p className="text-zinc-500 text-sm">
              Automatizujte své ML workflow na Kaggle a Colab s inteligencí Gemini.
            </p>
          </div>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:bg-zinc-200 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <img src="https://www.gstatic.com/firebase/static/bin/white/google.svg" className="w-5 h-5" alt="Google" />
            Pokračovat přes Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-24 font-sans">
      {/* Header */}
      <header className="p-6 flex items-center justify-between sticky top-0 bg-black/80 backdrop-blur-xl z-20 border-b border-zinc-900">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
            <Cpu className="w-6 h-6 text-black" />
          </div>
          <div>
            <h1 className="font-bold leading-none">KaggleAI</h1>
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Automatizátor</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsHelpOpen(true)}
            className="p-2 text-zinc-500 hover:text-white transition-colors"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button onClick={handleLogout} className="p-2 text-zinc-500 hover:text-white transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="p-4 space-y-6 max-w-2xl mx-auto">
        {currentTab === 'notebooks' ? (
          <>
            {/* Stats / Overview */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-emerald-500/5 border-emerald-500/10">
                <div className="flex items-center gap-2 text-emerald-500 mb-1">
                  <Activity className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">Aktivní</span>
                </div>
                <div className="text-2xl font-bold">{notebooks.filter(n => n.status === 'running').length}</div>
                <div className="text-[10px] text-zinc-500">Běžící notebooky</div>
              </Card>
              <Card>
                <div className="flex items-center gap-2 text-zinc-500 mb-1">
                  <Database className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">Celkem</span>
                </div>
                <div className="text-2xl font-bold">{notebooks.length}</div>
                <div className="text-[10px] text-zinc-500">Spravované projekty</div>
              </Card>
            </div>

            {/* Notebook List */}
            <section className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Vaše Notebooky</h2>
                <button 
                  onClick={() => setIsAdding(true)}
                  className="p-1.5 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                {notebooks.map((nb) => (
                  <motion.div 
                    key={nb.id}
                    layoutId={nb.id}
                    onClick={() => setSelectedNotebook(nb)}
                    className={cn(
                      "group relative overflow-hidden transition-all active:scale-[0.98]",
                      selectedNotebook?.id === nb.id ? "ring-2 ring-emerald-500" : ""
                    )}
                  >
                    <Card className={cn(
                      "cursor-pointer hover:border-zinc-700 transition-colors",
                      selectedNotebook?.id === nb.id ? "bg-zinc-900" : ""
                    )}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center",
                            nb.platform === 'kaggle' ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"
                          )}>
                            {nb.platform === 'kaggle' ? <Database className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
                          </div>
                          <div>
                            <h3 className="font-bold text-sm">{nb.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant={nb.status === 'running' ? 'success' : nb.status === 'error' ? 'error' : 'default'} className="flex items-center gap-1">
                                {nb.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                {nb.status === 'error' && <AlertCircle className="w-2.5 h-2.5" />}
                                {nb.status === 'completed' && <CheckCircle2 className="w-2.5 h-2.5" />}
                                {nb.status === 'idle' && <Clock className="w-2.5 h-2.5" />}
                                {nb.status}
                              </Badge>
                              <span className="text-[10px] text-zinc-500 capitalize">{nb.platform}</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                      </div>
                      
                      {nb.status === 'running' && (
                        <div className="mt-4 space-y-2">
                          <div className="flex justify-between text-[10px] font-bold uppercase text-zinc-500">
                            <span>Průběh</span>
                            <span>{nb.progress || 0}%</span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${nb.progress || 0}%` }}
                              className="h-full bg-emerald-500"
                            />
                          </div>
                          {nb.lastLoss !== undefined && (
                            <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-mono">
                              <Activity className="w-3 h-3" />
                              Loss: {nb.lastLoss.toFixed(4)}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  </motion.div>
                ))}

                {notebooks.length === 0 && (
                  <div className="text-center py-12 border-2 border-dashed border-zinc-900 rounded-3xl space-y-4">
                    <p className="text-zinc-500 text-sm">Zatím nebyly přidány žádné notebooky.</p>
                    <button 
                      onClick={seedSampleData}
                      disabled={isSeeding}
                      className="px-6 py-2 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-all flex items-center gap-2 mx-auto"
                    >
                      {isSeeding ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Vytvořit ukázková data
                    </button>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : currentTab === 'models' ? (
          /* Models Tab */
          <section className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Vaše Modely</h2>
              <div className="flex items-center gap-2">
                <Tooltip text="Nahrát vlastní model (PyTorch, TF, atd.)">
                  <label className="p-1.5 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors cursor-pointer">
                    <Plus className="w-4 h-4" />
                    <input type="file" className="hidden" onChange={handleFileUpload} />
                  </label>
                </Tooltip>
                <button 
                  onClick={() => setIsAddingModel(true)}
                  className="p-1.5 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 transition-colors"
                >
                  <Save className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Database className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchKaggle()}
                placeholder="Hledat na Kaggle (např. 'resnet')..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button 
                onClick={searchKaggle}
                disabled={isSearchingKaggle}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 text-black rounded-xl hover:bg-emerald-400 disabled:opacity-50"
              >
                {isSearchingKaggle ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            <div className="space-y-3">
              {models.map((m) => (
                <Card key={m.id} className="hover:border-zinc-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
                        <Database className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">{m.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge>{m.framework}</Badge>
                          {m.isPublic && <Badge variant="success">Veřejný</Badge>}
                          {m.size && <span className="text-[10px] text-zinc-500">{(m.size / 1024 / 1024).toFixed(1)} MB</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tooltip text="Importovat do notebooku">
                        <button 
                          onClick={() => setLinkingModel(m)}
                          className="p-2 text-zinc-600 hover:text-emerald-500 transition-colors"
                        >
                          <Link className="w-4 h-4" />
                        </button>
                      </Tooltip>
                      <button className="p-2 text-zinc-600 hover:text-white">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}

              {models.length === 0 && !modelSearch && (
                <div className="text-center py-12 border-2 border-dashed border-zinc-900 rounded-3xl space-y-4">
                  <p className="text-zinc-500 text-sm">Zatím žádné vlastní modely.</p>
                  <button 
                    onClick={seedSampleData}
                    disabled={isSeeding}
                    className="px-6 py-2 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-all flex items-center gap-2 mx-auto"
                  >
                    {isSeeding ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    Vytvořit ukázková data
                  </button>
                </div>
              )}
            </div>

            {/* Public Models Section */}
            {publicModels.length > 0 && (
              <div className="space-y-3 pt-4">
                <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest px-2">Veřejné Modely</h3>
                {publicModels.map((m) => (
                  <Card key={m.id} className="border-blue-500/10 bg-blue-500/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500">
                          <Database className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm">{m.name}</h3>
                          <p className="text-[10px] text-zinc-500">Veřejný • {m.framework} • {m.version ? `v${m.version}` : 'v1'}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setLinkingModel(m)}
                        className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Kaggle Results */}
            {kaggleDatasets.length > 0 && (
              <div className="space-y-4 pt-4">
                <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest px-2">Výsledky z Kaggle</h3>
                <div className="space-y-3">
                  {kaggleDatasets.map((ds: any) => (
                    <Card key={ds.ref} className="border-emerald-500/20 bg-emerald-500/5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500">
                            <Database className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm">{ds.title}</h3>
                            <p className="text-[10px] text-zinc-500">{ds.ref} • {ds.size}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            addDoc(collection(db, 'models'), {
                              userId: user.uid,
                              name: ds.title,
                              framework: 'other',
                              isPublic: true,
                              createdAt: serverTimestamp(),
                              tags: ['kaggle', ds.ref]
                            });
                            setKaggleDatasets(prev => prev.filter(d => d.ref !== ds.ref));
                          }}
                          className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          /* Datasets Tab */
          <section className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Datasety & Kolekce</h2>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsAddingCollection(true)}
                  className="p-1.5 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                >
                  <Tooltip text="Nová Kolekce">
                    <Database className="w-4 h-4" />
                  </Tooltip>
                </button>
                <button 
                  onClick={() => setIsAddingDataset(true)}
                  className="p-1.5 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Collections Section */}
            {collections.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest px-2">Vaše Kolekce</h3>
                <div className="grid grid-cols-1 gap-3">
                  {collections.map((coll) => (
                    <Card key={coll.id} className="border-blue-500/20 bg-blue-500/5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400">
                            <Database className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-sm">{coll.name}</h3>
                            <p className="text-[10px] text-zinc-500">{coll.datasetIds.length} datasetů</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setEditingCollection(coll)}
                          className="p-2 text-zinc-600 hover:text-white"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 border-2 border-dashed border-zinc-900 rounded-3xl space-y-3">
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Žádné vlastní kolekce</p>
                <button 
                  onClick={seedSampleData}
                  disabled={isSeeding}
                  className="px-4 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg text-[10px] font-bold hover:bg-zinc-700 transition-all"
                >
                  Vytvořit ukázkovou kolekci
                </button>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest px-2">Moje Datasety</h3>
              {datasets.map((ds) => (
                <Card key={ds.id} className="hover:border-zinc-700 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
                        <HardDrive className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm">{ds.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge>{ds.format}</Badge>
                          {ds.isPublic && <Badge variant="success">Veřejný</Badge>}
                          <span className="text-[10px] text-zinc-500">
                            {ds.createdAt?.toDate().toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setLinkingDataset(ds)}
                        className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"
                      >
                        <Link className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-zinc-600 hover:text-white">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}

              {datasets.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-zinc-900 rounded-3xl space-y-4">
                  <p className="text-zinc-500 text-sm">Zatím žádné vlastní datasety.</p>
                  <button 
                    onClick={seedSampleData}
                    disabled={isSeeding}
                    className="px-6 py-2 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-all flex items-center gap-2 mx-auto"
                  >
                    {isSeeding ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    Vytvořit ukázková data
                  </button>
                </div>
              )}
            </div>

            {/* Public Datasets Section */}
            {publicDatasets.length > 0 && (
              <div className="space-y-3 pt-4">
                <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest px-2">Veřejné Datasety</h3>
                {publicDatasets.map((ds) => (
                  <Card key={ds.id} className="border-emerald-500/10 bg-emerald-500/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500">
                          <HardDrive className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm">{ds.name}</h3>
                          <p className="text-[10px] text-zinc-500">Veřejný • {ds.format}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setLinkingDataset(ds)}
                        className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Selected Notebook Detail / Automation Panel */}
      <AnimatePresence>
        {selectedNotebook && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-30 bg-black flex flex-col"
          >
            <header className="p-6 flex items-center justify-between border-b border-zinc-900">
              <button onClick={() => setSelectedNotebook(null)} className="text-zinc-500 hover:text-white">
                Zpět
              </button>
              <div className="text-center">
                <h2 className="font-bold">{selectedNotebook.name}</h2>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{selectedNotebook.platform}</p>
                  {selectedNotebook.gpuEnabled && <Badge variant="success" className="text-[8px]">GPU: {selectedNotebook.gpuType}</Badge>}
                  {selectedNotebook.internetEnabled && <Badge variant="default" className="text-[8px]">Internet</Badge>}
                </div>
              </div>
              <button className="p-2 text-zinc-500">
                <Settings className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Monitoring */}
              {logs.length > 0 && logs[0].metrics && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">Monitoring Zdrojů</h3>
                    <span className="text-[8px] text-emerald-500 animate-pulse">LIVE</span>
                  </div>
                  <ResourceMonitor metrics={logs[0].metrics} />
                </section>
              )}

              {/* Datasets Section */}
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">Přiřazené Datasety & Kolekce</h3>
                  <span className="text-[10px] text-zinc-600">
                    {(selectedNotebook.datasetIds?.length || 0) + (selectedNotebook.collectionIds?.length || 0)} aktivní
                  </span>
                </div>
                
                {/* Collections in Notebook */}
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {collections.map((coll) => {
                    const isAssigned = selectedNotebook.collectionIds?.includes(coll.id);
                    return (
                      <button 
                        key={coll.id}
                        onClick={() => toggleCollectionAssignment(selectedNotebook.id, coll.id)}
                        className={cn(
                          "flex-shrink-0 px-4 py-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-2",
                          isAssigned 
                            ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                            : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                        )}
                      >
                        <Database className="w-3 h-3" />
                        {coll.name} (Kolekce)
                        {isAssigned && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {allDatasets.map((ds) => {
                    const isAssigned = selectedNotebook.datasetIds?.includes(ds.id);
                    return (
                      <button 
                        key={ds.id}
                        onClick={() => toggleDatasetAssignment(selectedNotebook.id, ds.id)}
                        className={cn(
                          "flex-shrink-0 px-4 py-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-2",
                          isAssigned 
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500" 
                            : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                        )}
                      >
                        <HardDrive className="w-3 h-3" />
                        {ds.name}
                        {isAssigned && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Models Section */}
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">Importované Modely</h3>
                  <span className="text-[10px] text-zinc-600">{selectedNotebook.modelIds?.length || 0} aktivní</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {allModels.map((m) => {
                    const isAssigned = selectedNotebook.modelIds?.includes(m.id);
                    return (
                      <button 
                        key={m.id}
                        onClick={() => toggleModelAssignment(selectedNotebook.id, m.id)}
                        className={cn(
                          "flex-shrink-0 px-4 py-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-2",
                          isAssigned 
                            ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                            : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                        )}
                      >
                        <Database className="w-3 h-3" />
                        {m.name}
                        {isAssigned && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                  {allModels.length === 0 && (
                    <button 
                      onClick={seedSampleData}
                      disabled={isSeeding}
                      className="text-[10px] text-zinc-600 italic px-1 hover:text-zinc-400 transition-colors"
                    >
                      {isSeeding ? "Generování..." : "Žádné modely. Klikněte pro ukázková data."}
                    </button>
                  )}
                </div>
              </section>

              {/* Automation Prompt */}
              <Card className="bg-emerald-500/5 border-emerald-500/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-emerald-500">
                    <MessageSquare className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase">AI Zadání Automatizace</span>
                  </div>
                  <Tooltip text="Zadejte instrukce pro Gemini, co má v notebooku udělat.">
                    <Info className="w-3 h-3 text-zinc-600" />
                  </Tooltip>
                </div>
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="např. Trénuj ResNet50 na CIFAR-10, oprav chyby s pamětí, autosave každých 5 epoch..."
                  className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 min-h-[100px]"
                />
                <div className="flex gap-2 mt-3">
                  <button 
                    onClick={startAutomation}
                    disabled={isGenerating || !prompt}
                    className="flex-1 py-3 bg-emerald-500 text-black font-bold rounded-xl hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  >
                    {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                    Spustit Automatizaci
                  </button>
                  <button className="px-4 py-3 bg-zinc-800 text-white rounded-xl hover:bg-zinc-700">
                    <Save className="w-5 h-5" />
                  </button>
                </div>
              </Card>

              {/* Real-time Logs */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">Živý Výstup</h3>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] text-emerald-500 font-bold uppercase">Sledování</span>
                  </div>
                </div>
                <div className="space-y-2 font-mono text-[11px]">
                  {logs.map((log) => {
                    const isError = log.message.toLowerCase().includes('error') || log.message.toLowerCase().includes('chyba');
                    const isSuccess = log.message.toLowerCase().includes('success') || log.message.toLowerCase().includes('dokončeno') || log.message.toLowerCase().includes('hotovo');
                    
                    return (
                      <div key={log.id} className={cn(
                        "p-3 bg-zinc-950 border rounded-lg flex gap-3 transition-colors",
                        isError ? "border-red-500/20 bg-red-500/5" : 
                        isSuccess ? "border-emerald-500/20 bg-emerald-500/5" : 
                        "border-zinc-900"
                      )}>
                        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                          <span className="text-[9px] text-zinc-600 font-bold">
                            {log.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          {isError ? <AlertCircle className="w-3 h-3 text-red-500" /> : 
                           isSuccess ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : 
                           <Info className="w-3 h-3 text-zinc-500" />}
                        </div>
                        <div className="space-y-1 flex-1">
                          <p className={cn(
                            isError ? "text-red-400" : 
                            isSuccess ? "text-emerald-400" : 
                            "text-zinc-300"
                          )}>
                            {log.message}
                          </p>
                          {log.aiResponse && (
                            <div className="mt-2 p-2 bg-black/40 rounded border border-zinc-800 text-[10px] text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono">
                              {log.aiResponse}
                            </div>
                          )}
                          {log.loss !== undefined && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold">
                              <span className="text-emerald-500/80">Loss: {log.loss.toFixed(4)}</span>
                              {log.accuracy !== undefined && <span className="text-blue-400/80">Acc: {(log.accuracy * 100).toFixed(1)}%</span>}
                              {log.epoch !== undefined && <span className="text-orange-400/80">Epoch: {log.epoch}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {logs.length === 0 && (
                    <div className="text-center py-8 text-zinc-600 italic">
                      Čekání na logy...
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Action Bar */}
            <div className="p-6 bg-zinc-950 border-t border-zinc-900 flex gap-4">
              <button 
                onClick={() => setIsConsoleOpen(true)}
                className="flex-1 py-4 bg-zinc-900 text-white font-bold rounded-2xl flex items-center justify-center gap-2"
              >
                <Terminal className="w-5 h-5" />
                Konzole
              </button>
              <button 
                onClick={() => stopAutomation(selectedNotebook.id)}
                className="flex-1 py-4 bg-red-500/10 text-red-500 font-bold rounded-2xl flex items-center justify-center gap-2 border border-red-500/20"
              >
                <Square className="w-5 h-5 fill-current" />
                Zastavit
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Console Modal */}
      <AnimatePresence>
        {isConsoleOpen && selectedNotebook && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConsoleOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-4xl h-[80vh] bg-zinc-950 rounded-[32px] border border-zinc-800 flex flex-col overflow-hidden shadow-2xl"
            >
              <header className="p-6 border-b border-zinc-900 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold">Interaktivní Konzole</h2>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Běžící skript: {selectedNotebook.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => stopAutomation(selectedNotebook.id)}
                    className="px-4 py-2 bg-red-500/10 text-red-500 text-xs font-bold rounded-xl border border-red-500/20 hover:bg-red-500/20 transition-all"
                  >
                    Zastavit Proces
                  </button>
                  <button onClick={() => setIsConsoleOpen(false)} className="p-2 text-zinc-500 hover:text-white">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </header>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="p-4 bg-black/40 border-b border-zinc-900 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Python Skript (Upravitelný)</span>
                  <button 
                    onClick={() => {
                      const textarea = document.getElementById('console-script-editor') as HTMLTextAreaElement;
                      if (textarea) updateNotebookScript(selectedNotebook.id, textarea.value);
                    }}
                    className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold rounded-lg border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                  >
                    <Save className="w-3 h-3" />
                    Uložit & Přepsat
                  </button>
                </div>
                <textarea 
                  id="console-script-editor"
                  defaultValue={selectedNotebook.config?.script || ''}
                  className="flex-1 w-full bg-black p-6 font-mono text-xs text-emerald-500/90 focus:outline-none resize-none selection:bg-emerald-500/20"
                  spellCheck={false}
                />
              </div>

              <footer className="p-4 bg-zinc-900/30 border-t border-zinc-900 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] text-zinc-400 font-bold uppercase">Status: {selectedNotebook.status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Activity className="w-3 h-3 text-zinc-500" />
                    <span className="text-[10px] text-zinc-400 font-bold uppercase">Progress: {Math.round(selectedNotebook.progress || 0)}%</span>
                  </div>
                </div>
                <div className="text-[10px] text-zinc-600 font-mono">
                  Runtime: {selectedNotebook.platform} | GPU: {selectedNotebook.gpuEnabled ? 'ON' : 'OFF'}
                </div>
              </footer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Notebook Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800"
            >
              <h2 className="text-xl font-bold mb-6">Nový Notebook</h2>
              <form onSubmit={addNotebook} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Název Projektu</label>
                  <input 
                    name="name"
                    required
                    placeholder="např. MNIST Klasifikátor"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Platforma</label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="relative cursor-pointer">
                      <input type="radio" name="platform" value="kaggle" defaultChecked className="peer sr-only" />
                      <div className="p-4 bg-black border border-zinc-800 rounded-2xl text-center peer-checked:border-emerald-500 peer-checked:bg-emerald-500/5 transition-all">
                        <Database className="w-6 h-6 mx-auto mb-2 text-blue-400" />
                        <span className="text-sm font-bold">Kaggle</span>
                      </div>
                    </label>
                    <label className="relative cursor-pointer">
                      <input type="radio" name="platform" value="colab" className="peer sr-only" />
                      <div className="p-4 bg-black border border-zinc-800 rounded-2xl text-center peer-checked:border-emerald-500 peer-checked:bg-emerald-500/5 transition-all">
                        <Cpu className="w-6 h-6 mx-auto mb-2 text-orange-400" />
                        <span className="text-sm font-bold">Colab</span>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="space-y-4 pt-4 border-t border-zinc-800">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Terminal className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Virtuální Prostředí</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {['none', 'venv', 'conda'].map((type) => (
                      <label key={type} className="relative cursor-pointer">
                        <input type="radio" name="venvType" value={type} defaultChecked={type === 'none'} className="peer sr-only" />
                        <div className="py-2 bg-black border border-zinc-800 rounded-xl text-center peer-checked:border-emerald-500 peer-checked:bg-emerald-500/5 transition-all">
                          <span className="text-[10px] font-bold uppercase">{type}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <input 
                    name="venvName"
                    placeholder="Název prostředí (např. ml-env)"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="space-y-4 bg-black/40 p-4 rounded-2xl border border-zinc-800">
                  <h3 className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">Nastavení Zdrojů</h3>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm text-zinc-300">GPU Akcelerace</span>
                    </div>
                    <input type="checkbox" name="gpuEnabled" className="w-5 h-5 accent-emerald-500" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[8px] font-bold uppercase text-zinc-500">Typ GPU</label>
                      <select 
                        name="gpuType"
                        className="w-full bg-black border border-zinc-800 rounded-xl p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none"
                      >
                        <option value="T4">NVIDIA T4</option>
                        <option value="P100">NVIDIA P100</option>
                        <option value="V100">NVIDIA V100</option>
                        <option value="TPU">Google TPU</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[8px] font-bold uppercase text-zinc-500">Počet GPU</label>
                      <select 
                        name="gpuCount"
                        className="w-full bg-black border border-zinc-800 rounded-xl p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none"
                      >
                        <option value="1">1x GPU</option>
                        <option value="2">2x GPU</option>
                        <option value="4">4x GPU</option>
                        <option value="8">8x GPU</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm text-zinc-300">Internetové Připojení</span>
                    </div>
                    <input type="checkbox" name="internetEnabled" defaultChecked className="w-5 h-5 accent-emerald-500" />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Vytvořit Projekt
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Model Modal */}
      <AnimatePresence>
        {isAddingModel && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingModel(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800"
            >
              <h2 className="text-xl font-bold mb-6">Nový Model</h2>
              <form onSubmit={addModel} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Název Modelu</label>
                  <input 
                    name="name"
                    required
                    placeholder="např. MyAwesomeModel-v1"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Framework</label>
                  <select 
                    name="framework"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none"
                  >
                    <option value="pytorch">PyTorch</option>
                    <option value="tensorflow">TensorFlow</option>
                    <option value="jax">JAX</option>
                    <option value="other">Ostatní</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 px-1">
                  <input type="checkbox" name="isPublic" id="isPublic" className="w-5 h-5 accent-emerald-500" />
                  <label htmlFor="isPublic" className="text-sm text-zinc-400">Veřejný model</label>
                </div>
                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Uložit Model
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Link Model to Notebook Modal */}
      <AnimatePresence>
        {linkingModel && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLinkingModel(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">Importovat Model</h2>
                  <p className="text-xs text-zinc-500 mt-1">Vyberte notebook pro model {linkingModel.name}</p>
                </div>
                <button onClick={() => setLinkingModel(null)} className="p-2 text-zinc-500">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="space-y-3">
                {notebooks.map((nb) => {
                  const isLinked = nb.modelIds?.includes(linkingModel.id);
                  return (
                    <button 
                      key={nb.id}
                      onClick={() => toggleModelAssignment(nb.id, linkingModel.id)}
                      className={cn(
                        "w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between",
                        isLinked 
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500" 
                          : "bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {nb.platform === 'kaggle' ? <Database className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
                        <span className="font-bold text-sm">{nb.name}</span>
                      </div>
                      {isLinked && <Check className="w-4 h-4" />}
                    </button>
                  );
                })}
                {notebooks.length === 0 && (
                  <div className="text-center py-8 text-zinc-600 italic text-sm">
                    Nemáte žádné notebooky.
                  </div>
                )}
              </div>
              
              <button 
                onClick={() => setLinkingModel(null)}
                className="w-full mt-6 py-4 bg-zinc-800 text-white font-bold rounded-2xl"
              >
                Hotovo
              </button>
            </motion.div>
          </div>
        )}

        {linkingDataset && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLinkingDataset(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">Přiřadit Dataset</h2>
                  <p className="text-xs text-zinc-500 mt-1">Vyberte notebook pro dataset {linkingDataset.name}</p>
                </div>
                <button onClick={() => setLinkingDataset(null)} className="p-2 text-zinc-500">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="space-y-3">
                {notebooks.map((nb) => {
                  const isLinked = nb.datasetIds?.includes(linkingDataset.id);
                  return (
                    <button 
                      key={nb.id}
                      onClick={() => toggleDatasetAssignment(nb.id, linkingDataset.id)}
                      className={cn(
                        "w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between",
                        isLinked 
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500" 
                          : "bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {nb.platform === 'kaggle' ? <Database className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
                        <span className="font-bold text-sm">{nb.name}</span>
                      </div>
                      {isLinked && <Check className="w-4 h-4" />}
                    </button>
                  );
                })}
                {notebooks.length === 0 && (
                  <div className="text-center py-8 text-zinc-600 italic text-sm">
                    Nemáte žádné notebooky.
                  </div>
                )}
              </div>
              
              <button 
                onClick={() => setLinkingDataset(null)}
                className="w-full mt-6 py-4 bg-zinc-800 text-white font-bold rounded-2xl"
              >
                Hotovo
              </button>
            </motion.div>
          </div>
        )}

        {editingCollection && (() => {
          const currentColl = collections.find(c => c.id === editingCollection.id) || editingCollection;
          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingCollection(null)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800 max-h-[80vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold">Upravit Kolekci</h2>
                    <p className="text-xs text-zinc-500 mt-1">{currentColl.name}</p>
                  </div>
                  <button onClick={() => setEditingCollection(null)} className="p-2 text-zinc-500">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Datasety v kolekci</label>
                    <div className="space-y-2">
                      {allDatasets.map((ds) => {
                        const isInCollection = currentColl.datasetIds?.includes(ds.id);
                        return (
                          <button 
                            key={ds.id}
                            onClick={() => toggleDatasetInCollection(currentColl.id, ds.id)}
                            className={cn(
                              "w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between",
                              isInCollection 
                                ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                                : "bg-black border-zinc-800 text-zinc-500 hover:border-zinc-700"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <HardDrive className="w-4 h-4" />
                              <span className="text-sm">{ds.name}</span>
                            </div>
                            {isInCollection && <Check className="w-4 h-4" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={() => setEditingCollection(null)}
                  className="w-full mt-6 py-4 bg-zinc-800 text-white font-bold rounded-2xl"
                >
                  Zavřít
                </button>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* Add Dataset Modal */}
      <AnimatePresence>
        {isAddingDataset && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingDataset(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800"
            >
              <h2 className="text-xl font-bold mb-6">Nový Dataset</h2>
              <form onSubmit={addDataset} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Název Datasetu</label>
                  <input 
                    name="name"
                    required
                    placeholder="např. CIFAR-10-Processed"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Formát</label>
                  <select 
                    name="format"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none"
                  >
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                    <option value="images">Images (ZIP)</option>
                    <option value="hdf5">HDF5</option>
                    <option value="other">Ostatní</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Popis (volitelné)</label>
                  <textarea 
                    name="description"
                    placeholder="Stručný popis obsahu..."
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500 h-24 resize-none"
                  />
                </div>
                <div className="flex items-center gap-3 px-1">
                  <input type="checkbox" name="isPublic" id="dsIsPublic" className="w-5 h-5 accent-emerald-500" />
                  <label htmlFor="dsIsPublic" className="text-sm text-zinc-400">Veřejný dataset</label>
                </div>
                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Vytvořit Dataset
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Collection Modal */}
      <AnimatePresence>
        {isAddingCollection && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingCollection(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800"
            >
              <h2 className="text-xl font-bold mb-6">Nová Kolekce</h2>
              <form onSubmit={addCollection} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Název Kolekce</label>
                  <input 
                    name="name"
                    required
                    placeholder="např. Computer Vision Pack"
                    className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Vyberte Datasetů</label>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {datasets.map(ds => (
                      <label key={ds.id} className="flex items-center gap-3 p-3 bg-black rounded-xl border border-zinc-800 cursor-pointer hover:border-zinc-700">
                        <input type="checkbox" name="datasetIds" value={ds.id} className="w-4 h-4 accent-emerald-500" />
                        <span className="text-sm text-zinc-300">{ds.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Vytvořit Kolekci
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] p-8 border border-zinc-800 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Nastavení API Klíčů</h2>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 text-zinc-500 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={saveSettings} className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-400">
                      <Database className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Kaggle Konfigurace</span>
                    </div>
                    <div className="flex bg-black rounded-lg p-1 border border-zinc-800">
                      <button 
                        type="button"
                        onClick={() => setKaggleInputMode('manual')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                          kaggleInputMode === 'manual' ? "bg-zinc-800 text-white" : "text-zinc-500"
                        )}
                      >
                        MANUÁLNÍ
                      </button>
                      <button 
                        type="button"
                        onClick={() => setKaggleInputMode('json')}
                        className={cn(
                          "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                          kaggleInputMode === 'json' ? "bg-zinc-800 text-white" : "text-zinc-500"
                        )}
                      >
                        JSON
                      </button>
                    </div>
                  </div>

                  {kaggleInputMode === 'manual' ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Kaggle Uživatelské Jméno</label>
                        <input 
                          name="kaggleUsername"
                          defaultValue={userProfile?.kaggleUsername}
                          placeholder="např. john_doe"
                          className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Kaggle API Klíč</label>
                        <div className="relative">
                          <input 
                            name="kaggleApiKey"
                            type="password"
                            defaultValue={userProfile?.kaggleApiKey}
                            placeholder="••••••••••••••••"
                            className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500 pr-12"
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2">
                            {isVerifyingKaggle ? (
                              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                            ) : kaggleVerifyStatus === 'success' ? (
                              <Check className="w-5 h-5 text-emerald-500" />
                            ) : kaggleVerifyStatus === 'error' ? (
                              <AlertCircle className="w-5 h-5 text-red-500" />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Vložit kaggle.json</label>
                      <div className="relative">
                        <textarea 
                          value={kaggleJson}
                          onChange={(e) => handleKaggleJsonChange(e.target.value)}
                          placeholder='{ "username": "...", "key": "..." }'
                          className="w-full h-32 bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-xs resize-none"
                        />
                        <div className="absolute right-4 bottom-4">
                          {isVerifyingKaggle ? (
                            <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                          ) : kaggleVerifyStatus === 'success' ? (
                            <div className="flex items-center gap-2 text-emerald-500">
                              <span className="text-[10px] font-bold uppercase">Připojeno</span>
                              <Check className="w-5 h-5" />
                            </div>
                          ) : kaggleVerifyStatus === 'error' ? (
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}

                  <button 
                    type="button"
                    onClick={() => {
                      const form = document.querySelector('form');
                      const username = (form?.querySelector('[name="kaggleUsername"]') as HTMLInputElement)?.value;
                      const apiKey = (form?.querySelector('[name="kaggleApiKey"]') as HTMLInputElement)?.value;
                      if (username && apiKey) verifyKaggle(username, apiKey);
                    }}
                    className="w-full py-2 text-[10px] font-bold uppercase text-zinc-500 hover:text-white transition-colors"
                  >
                    Testovat Připojení
                  </button>
                </div>

                <div className="space-y-4 pt-4 border-t border-zinc-800">
                  <div className="flex items-center gap-2 text-orange-400">
                    <Cpu className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Colab Konfigurace</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase text-zinc-500 ml-1">Colab Auth Token</label>
                    <input 
                      name="colabToken"
                      type="password"
                      defaultValue={userProfile?.colabToken}
                      placeholder="••••••••••••••••"
                      className="w-full bg-black border border-zinc-800 rounded-2xl p-4 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                  <p className="text-[10px] text-emerald-500/70 leading-relaxed">
                    Vaše klíče jsou uloženy v zabezpečené databázi Firestore a jsou přístupné pouze vám. Nikdy je nesdílejte s nikým jiným.
                  </p>
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Uložit Nastavení
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Nav (Mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-zinc-900 p-4 flex justify-around items-center z-20">
        <button 
          onClick={() => setCurrentTab('notebooks')}
          className={cn("p-2 transition-colors", currentTab === 'notebooks' ? "text-emerald-500" : "text-zinc-500")}
        >
          <Tooltip text="Notebooky">
            <Activity className="w-6 h-6" />
          </Tooltip>
        </button>
        <button 
          onClick={() => setCurrentTab('models')}
          className={cn("p-2 transition-colors", currentTab === 'models' ? "text-emerald-500" : "text-zinc-500")}
        >
          <Tooltip text="Modely">
            <Database className="w-6 h-6" />
          </Tooltip>
        </button>
        <button 
          onClick={() => currentTab === 'notebooks' ? setIsAdding(true) : currentTab === 'models' ? setIsAddingModel(true) : setIsAddingDataset(true)}
          className="w-12 h-12 bg-emerald-500 text-black rounded-full flex items-center justify-center -mt-10 shadow-lg shadow-emerald-500/20 border-4 border-black"
        >
          <Plus className="w-6 h-6" />
        </button>
        <button 
          onClick={() => setCurrentTab('datasets')}
          className={cn("p-2 transition-colors", currentTab === 'datasets' ? "text-emerald-500" : "text-zinc-500")}
        >
          <Tooltip text="Datasety">
            <HardDrive className="w-6 h-6" />
          </Tooltip>
        </button>
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className={cn("p-2 transition-colors", isSettingsOpen ? "text-emerald-500" : "text-zinc-500")}
        >
          <Tooltip text="Nastavení">
            <Settings className="w-6 h-6" />
          </Tooltip>
        </button>
      </nav>

      {/* Help Modal */}
      <AnimatePresence>
        {isHelpOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHelpOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg bg-zinc-900 rounded-[32px] p-8 border border-zinc-800 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Nápověda & FAQ</h2>
                <button onClick={() => setIsHelpOpen(false)} className="p-2 text-zinc-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <section className="space-y-2">
                  <h3 className="text-emerald-500 font-bold flex items-center gap-2">
                    <Cpu className="w-4 h-4" />
                    Jak funguje Gemini?
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    Gemini AI je integrována přímo do aplikace. Pro její základní funkce (generování skriptů, analýza logů) **nepotřebujete vlastní API klíč**. Vše je spravováno platformou.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-blue-400 font-bold flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Kaggle & Colab integrace
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    Pro plnou funkčnost (spouštění notebooků, stahování modelů) musíte v **Nastavení** zadat své Kaggle API údaje nebo Colab Auth Token. Login do aplikace probíhá přes Google (Firebase Auth).
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-orange-400 font-bold flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    Správa Datasetů
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    Datasety můžete vytvářet v samostatné záložce a následně je v detailu notebooku "připínat". To umožňuje AI agentovi vědět, která data má při tréninku použít.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-zinc-300 font-bold flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Automatizace
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    V detailu notebooku zadejte textové zadání (např. "Trénuj model 10 epoch a ulož nejlepší váhy"). AI vygeneruje Python skript a pokusí se jej vzdáleně spustit.
                  </p>
                </section>

                <div className="p-4 bg-zinc-800/50 rounded-2xl border border-zinc-700">
                  <p className="text-[10px] text-zinc-500 text-center">
                    Verze 1.2.0 • Vyvinuto pro efektivní ML workflow
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
