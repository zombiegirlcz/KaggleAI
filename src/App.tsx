import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, SafeAreaView, StatusBar, Dimensions } from 'react-native';
import { auth, db, googleProvider } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, onSnapshot, query, where, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';

const { width } = Dimensions.get('window');

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notebooks, setNotebooks] = useState([]);
  const [currentTab, setCurrentTab] = useState('notebooks');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'notebooks'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setNotebooks(data);
    }, (error) => {
      console.error("Firestore error:", error);
    });

    return unsubscribe;
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.loginContent}>
          <Text style={styles.title}>KaggleAI Mobile</Text>
          <Text style={styles.subtitle}>Manage your AI training from anywhere</Text>
          <TouchableOpacity style={styles.loginButton} onPress={handleLogin}>
            <Text style={styles.loginButtonText}>Sign in with Google</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSubtitle}>{user.email}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {['notebooks', 'models', 'datasets'].map((tab) => (
          <TouchableOpacity 
            key={tab} 
            onPress={() => setCurrentTab(tab)}
            style={[styles.tab, currentTab === tab && styles.activeTab]}
          >
            <Text style={[styles.tabText, currentTab === tab && styles.activeTabText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={styles.content}>
        {currentTab === 'notebooks' ? (
          notebooks.length > 0 ? (
            notebooks.map((nb) => (
              <View key={nb.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{nb.name}</Text>
                  <View style={[styles.badge, nb.status === 'running' ? styles.badgeRunning : styles.badgeIdle]}>
                    <Text style={styles.badgeText}>{nb.status}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>{nb.platform} • {nb.gpuEnabled ? nb.gpuType : 'CPU'}</Text>
                
                {nb.status === 'running' && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${nb.progress || 0}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{Math.round(nb.progress || 0)}%</Text>
                  </View>
                )}
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No notebooks found</Text>
            </View>
          )
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{currentTab} management coming soon to mobile</Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loginContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#a1a1aa',
    textAlign: 'center',
    marginBottom: 40,
  },
  loginButton: {
    backgroundColor: '#10b981',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#71717a',
  },
  logoutBtn: {
    padding: 8,
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    padding: 10,
    gap: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#18181b',
  },
  activeTab: {
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  tabText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 15,
  },
  card: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  cardMeta: {
    fontSize: 12,
    color: '#71717a',
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeRunning: {
    backgroundColor: '#10b98120',
  },
  badgeIdle: {
    backgroundColor: '#27272a',
  },
  badgeText: {
    fontSize: 10,
    color: '#10b981',
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#27272a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10b981',
  },
  progressText: {
    fontSize: 10,
    color: '#a1a1aa',
    width: 30,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabText: {
    fontSize: 30,
    color: '#fff',
    marginTop: -2,
  }
});
