"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
};

type AuthMode = "login" | "signup";

type TabKey = "access" | "profile";

function isMissingProfilesTable(error: any) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes('relation "profiles"') && message.includes("does not exist");
}

export default function UsersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>("access");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const avatarUrl =
    profile?.avatar_url || (user?.user_metadata?.avatar_url as string | undefined) || null;

  const clearNotices = () => {
    setMessage(null);
    setError(null);
  };

  useEffect(() => {
    let alive = true;
    supabaseBrowser.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setUser(data.user ?? null);
    });
    const { data: listener } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      return;
    }
    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    (async () => {
      try {
        const { data, error } = await supabaseBrowser
          .from("profiles")
          .select("id,email,display_name,avatar_url,bio")
          .eq("id", user.id)
          .maybeSingle();
        if (!active) return;
        if (error) {
          if (isMissingProfilesTable(error)) {
            setProfileError("Table profils absente sur Supabase.");
          } else {
            setProfileError(error.message);
          }
        } else {
          setProfile(data as Profile | null);
          if (data?.display_name && !displayName) {
            setDisplayName(data.display_name);
          }
          if (data?.bio && !bio) {
            setBio(data.bio);
          }
        }
      } finally {
        if (active) setProfileLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      setMessage("Connexion réussie.");
    }
    setBusy(false);
  };

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    const { data, error } = await supabaseBrowser.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || null },
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    if (data.user?.id) {
      await supabaseBrowser.from("profiles").upsert(
        {
          id: data.user.id,
          email: data.user.email ?? email,
          display_name: displayName || null,
          avatar_url: data.user.user_metadata?.avatar_url ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    }

    setMessage(
      data.session
        ? "Compte créé, vous êtes connecté."
        : "Compte créé. Vérifie ton email pour valider l'inscription."
    );
    setBusy(false);
  };

  const handleGoogle = async () => {
    clearNotices();
    setBusy(true);
    const redirectTo = `${window.location.origin}/users`;
    const { error } = await supabaseBrowser.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    clearNotices();
    setBusy(true);
    await supabaseBrowser.auth.signOut();
    setBusy(false);
  };

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    clearNotices();
    if (!user?.id) return;
    setBusy(true);
    const { error } = await supabaseBrowser.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? email,
        display_name: displayName || null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        bio: bio || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      setError(error.message);
    } else {
      setProfile((prev) => ({
        id: user.id,
        email: user.email ?? prev?.email ?? email,
        display_name: displayName || prev?.display_name || null,
        avatar_url: prev?.avatar_url ?? null,
        bio: bio || prev?.bio || null,
      }));
      setMessage("Profil mis à jour.");
    }
    setBusy(false);
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    clearNotices();
    if (!newPassword) return;
    setBusy(true);
    const { error } = await supabaseBrowser.auth.updateUser({ password: newPassword });
    if (error) {
      setError(error.message);
    } else {
      setMessage("Mot de passe mis à jour.");
      setNewPassword("");
    }
    setBusy(false);
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user?.id) return;
    clearNotices();
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo trop lourde (max 5MB).");
      return;
    }
    setAvatarBusy(true);
    const extension = file.name.split(".").pop() || "png";
    const filePath = `${user.id}/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabaseBrowser.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true });
    if (uploadError) {
      setError(uploadError.message);
      setAvatarBusy(false);
      return;
    }
    const { data } = supabaseBrowser.storage.from("avatars").getPublicUrl(filePath);
    const publicUrl = data?.publicUrl ?? null;
    const { error: updateError } = await supabaseBrowser.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? email,
        display_name: displayName || profile?.display_name || null,
        avatar_url: publicUrl,
        bio: bio || profile?.bio || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (updateError) {
      setError(updateError.message);
    } else {
      setProfile((prev) => ({
        id: user.id,
        email: user.email ?? prev?.email ?? email,
        display_name: displayName || prev?.display_name || null,
        avatar_url: publicUrl,
        bio: bio || prev?.bio || null,
      }));
      setMessage("Photo de profil mise à jour.");
    }
    setAvatarBusy(false);
  };

  const handleAvatarRemove = async () => {
    if (!user?.id) return;
    clearNotices();
    setAvatarBusy(true);
    const { error: updateError } = await supabaseBrowser.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? email,
        display_name: displayName || profile?.display_name || null,
        avatar_url: null,
        bio: bio || profile?.bio || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (updateError) {
      setError(updateError.message);
    } else {
      setProfile((prev) => ({
        id: user.id,
        email: user.email ?? prev?.email ?? email,
        display_name: displayName || prev?.display_name || null,
        avatar_url: null,
        bio: bio || prev?.bio || null,
      }));
      setMessage("Photo de profil supprimée.");
    }
    setAvatarBusy(false);
  };

  const displayEmail = profile?.email || user?.email || "";
  const profileName = profile?.display_name || displayName || user?.user_metadata?.display_name;

  const infoBadge = useMemo(() => {
    if (user) return "Connecté";
    return "Compte requis";
  }, [user]);

  return (
    <div className="min-h-screen p-6 text-white">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">Profil utilisateur</h1>
          <p className="text-sm text-white/70">
            Création de compte obligatoire pour utiliser l'application.
          </p>
        </div>

        {(error || message) && (
          <div
            className={`rounded-lg border px-4 py-2 text-sm ${
              error
                ? "border-red-400/50 bg-red-500/10 text-red-200"
                : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {error || message}
          </div>
        )}

        <div className="flex items-center gap-2">
          {([
            { key: "access", label: "Accès" },
            { key: "profile", label: "Profil" },
          ] as { key: TabKey; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 rounded-md border text-xs transition ${
                activeTab === tab.key
                  ? "border-white/60 text-white"
                  : "border-white/10 text-white/60 hover:text-white/80"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "access" ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Accès</h2>
                <p className="text-xs text-white/60">
                  {user ? "Session active" : "Connecte-toi ou crée un compte"}
                </p>
              </div>
              <span className="text-xs uppercase tracking-wide px-2 py-1 rounded-full bg-white/10 text-white/70">
                {infoBadge}
              </span>
            </div>

            {user ? (
              <div className="flex items-center gap-3">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={profileName || "Avatar"}
                    className="h-12 w-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-white/10 border border-white/10" />
                )}
                <div>
                  <div className="text-sm text-white/70">Connecté en tant que</div>
                  <div className="font-semibold">{profileName || displayEmail || "Utilisateur"}</div>
                  {displayEmail && <div className="text-xs text-white/50">{displayEmail}</div>}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-white/60">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`px-3 py-1 rounded-md border ${
                    authMode === "login"
                      ? "border-white/60 text-white"
                      : "border-white/10 text-white/60"
                  }`}
                >
                  Connexion
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("signup")}
                  className={`px-3 py-1 rounded-md border ${
                    authMode === "signup"
                      ? "border-white/60 text-white"
                      : "border-white/10 text-white/60"
                  }`}
                >
                  Création
                </button>
              </div>
            )}

            {!user && (
              <form
                className="space-y-3"
                onSubmit={authMode === "login" ? handleLogin : handleSignup}
              >
                <div className="space-y-1">
                  <label className="text-xs text-white/60">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                    placeholder="ton@email.com"
                    required
                  />
                </div>
                {authMode === "signup" && (
                  <div className="space-y-1">
                    <label className="text-xs text-white/60">Nom d'affichage</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                      placeholder="Charly"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs text-white/60">Mot de passe</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                    placeholder="********"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-md bg-emerald-500/80 hover:bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
                >
                  {authMode === "login" ? "Se connecter" : "Créer le compte"}
                </button>
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={busy}
                  className="w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm text-white transition disabled:opacity-60"
                >
                  Continuer avec Google
                </button>
              </form>
            )}

            {user && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={busy}
                  className="w-full rounded-md border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm text-white transition disabled:opacity-60"
                >
                  Se déconnecter
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Profil</h2>
              <p className="text-xs text-white/60">
                Modifie tes infos et la sécurité du compte.
              </p>
            </div>

            {profileError && (
              <div className="text-xs text-orange-200 border border-orange-400/40 bg-orange-500/10 rounded-md px-3 py-2">
                {profileError}
              </div>
            )}

            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={profileName || "Avatar"}
                  className="h-16 w-16 rounded-full object-cover border border-white/10"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-white/10 border border-white/10" />
              )}
              <div className="space-y-2">
                <div className="text-xs text-white/60">Photo de profil</div>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1 text-xs rounded-md border border-white/10 bg-white/5 hover:bg-white/10 cursor-pointer">
                    Importer
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      disabled={!user || avatarBusy}
                      className="sr-only"
                    />
                  </label>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleAvatarRemove}
                      disabled={avatarBusy}
                      className="px-3 py-1 text-xs rounded-md border border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                    >
                      Retirer
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-white/50">PNG/JPG, 5MB max.</div>
              </div>
            </div>

            <form className="space-y-3" onSubmit={handleProfileSave}>
              <div className="space-y-1">
                <label className="text-xs text-white/60">Email</label>
                <input
                  type="email"
                  value={displayEmail}
                  disabled
                  className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white/60"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-white/60">Nom d'affichage</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={!user || profileLoading}
                  className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:text-white/40"
                  placeholder="Nom public"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-white/60">Bio</label>
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  disabled={!user || profileLoading}
                  rows={3}
                  className="w-full resize-none rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:text-white/40"
                  placeholder="Dis-en un peu plus sur toi..."
                />
              </div>
              <button
                type="submit"
                disabled={busy || !user}
                className="w-full rounded-md bg-white/10 hover:bg-white/20 px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
              >
                Enregistrer le profil
              </button>
            </form>

            <div className="border-t border-white/10 pt-4">
              <h3 className="text-sm font-semibold">Mot de passe</h3>
              <form className="mt-3 space-y-3" onSubmit={handlePasswordUpdate}>
                <div className="space-y-1">
                  <label className="text-xs text-white/60">Nouveau mot de passe</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={!user}
                    className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:text-white/40"
                    placeholder="********"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || !user || !newPassword}
                  className="w-full rounded-md bg-emerald-500/80 hover:bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-60"
                >
                  Mettre à jour le mot de passe
                </button>
              </form>
            </div>

            {!user && (
              <div className="text-xs text-white/50">
                Connecte-toi pour accéder aux paramètres de profil.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
